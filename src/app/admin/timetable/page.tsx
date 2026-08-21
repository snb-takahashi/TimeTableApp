import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getDefaultOrganization } from "@/lib/org";
import { checkConflicts } from "@/lib/conflicts";
import { generateSchedule } from "@/lib/autoSchedule";
import {
  setGenerationState,
  clearCancellation,
  isCancellationRequested,
} from "@/lib/generationProgress";
import { ClassSelector } from "@/components/admin/ClassSelector";
import { AutoGenerateButton } from "@/components/admin/AutoGenerateButton";
import { DAY_LABELS, DAY_ORDER } from "@/lib/days";

async function assignEntry(formData: FormData) {
  "use server";
  const classGroupId = String(formData.get("classGroupId") ?? "");
  const timeSlotId = String(formData.get("timeSlotId") ?? "");
  const subjectId = String(formData.get("subjectId") ?? "");
  const teacherId = String(formData.get("teacherId") ?? "");
  const roomId = String(formData.get("roomId") ?? "");

  if (!classGroupId || !timeSlotId || !subjectId || !teacherId || !roomId) return;

  const org = await getDefaultOrganization();
  const conflict = await checkConflicts({ classGroupId, teacherId, roomId, timeSlotId });

  if (conflict.hasConflict) {
    redirect(
      `/admin/timetable?classId=${classGroupId}&error=${encodeURIComponent(conflict.reason)}`
    );
  }

  await prisma.timetableEntry.create({
    data: { organizationId: org.id, classGroupId, subjectId, teacherId, roomId, timeSlotId },
  });
  revalidatePath("/admin/timetable");
  redirect(`/admin/timetable?classId=${classGroupId}`);
}

// Upper bound on how many times a retryable failure is automatically
// retried before giving up — protects against burning server resources
// forever on a curriculum that's actually unsolvable in a way none of the
// upfront feasibility checks caught (e.g. a room-capacity conflict).
const MAX_AUTO_RETRIES = 50;

async function runAutoGenerate(formData: FormData) {
  "use server";
  const classGroupId = String(formData.get("classGroupId") ?? "");
  const org = await getDefaultOrganization();
  clearCancellation(org.id);

  let attempt = 0;
  let result: Awaited<ReturnType<typeof generateSchedule>>;
  do {
    attempt++;
    setGenerationState(org.id, { status: "running", percent: 0, attempt });
    result = await generateSchedule(
      org.id,
      (percent) => setGenerationState(org.id, { status: "running", percent, attempt }),
      () => isCancellationRequested(org.id)
    );
  } while (!result.success && !result.cancelled && result.retryable && attempt < MAX_AUTO_RETRIES);

  revalidatePath("/admin/timetable");

  if (result.success) {
    setGenerationState(org.id, { status: "done" });
    const notes: string[] = [];
    if (result.relaxedDailyCap) {
      notes.push("一部のクラスは1日3コマの上限内に収まらず、上限を超えて配置しました。");
    }
    if (result.relaxedTeacherContiguity) {
      notes.push("一部の非常勤教員はコマを連続・出勤日数最小にできず、通常どおりの配置になりました。");
    }
    const attemptNote = attempt > 1 ? `(${attempt}回目の試行で成功)` : "";
    const message = `時間割を自動生成しました(${result.placedCount}コマ配置)${attemptNote}。${notes.join("")}`;
    redirect(`/admin/timetable?classId=${classGroupId}&notice=${encodeURIComponent(message)}`);
  }

  if (result.cancelled) {
    setGenerationState(org.id, { status: "cancelled" });
    redirect(
      `/admin/timetable?classId=${classGroupId}&notice=${encodeURIComponent("自動生成をキャンセルしました。")}`
    );
  }

  const message =
    result.retryable && attempt >= MAX_AUTO_RETRIES
      ? `${MAX_AUTO_RETRIES}回自動的に再試行しましたが、${result.reason}`
      : result.reason;
  setGenerationState(org.id, { status: "error", message });
  redirect(`/admin/timetable?classId=${classGroupId}&error=${encodeURIComponent(message)}`);
}

async function removeEntry(formData: FormData) {
  "use server";
  const id = String(formData.get("id") ?? "");
  const classGroupId = String(formData.get("classGroupId") ?? "");
  if (!id) return;
  await prisma.timetableEntry.delete({ where: { id } });
  revalidatePath("/admin/timetable");
  redirect(`/admin/timetable?classId=${classGroupId}`);
}

export default async function TimetablePage({
  searchParams,
}: {
  searchParams: Promise<{ classId?: string; error?: string; notice?: string }>;
}) {
  const { classId, error, notice } = await searchParams;
  const org = await getDefaultOrganization();

  const [classGroups, subjects, teachers, rooms, timeSlots] = await Promise.all([
    prisma.classGroup.findMany({ where: { organizationId: org.id }, orderBy: { name: "asc" } }),
    prisma.subject.findMany({ where: { organizationId: org.id }, orderBy: { name: "asc" } }),
    prisma.teacher.findMany({ where: { organizationId: org.id }, orderBy: { name: "asc" } }),
    prisma.room.findMany({ where: { organizationId: org.id }, orderBy: { name: "asc" } }),
    prisma.timeSlot.findMany({ where: { organizationId: org.id } }),
  ]);

  const selectedClassId = classId ?? classGroups[0]?.id;

  if (!selectedClassId) {
    return (
      <p className="text-sm text-gray-600">
        まずクラスを登録してください(「クラス」メニューから追加できます)。
      </p>
    );
  }

  const entries = await prisma.timetableEntry.findMany({
    where: { organizationId: org.id, classGroupId: selectedClassId },
    include: { subject: true, teacher: true, room: true },
  });
  const entryBySlot = new Map(entries.map((e) => [e.timeSlotId, e]));

  const periods = [...new Set(timeSlots.map((s) => s.periodNumber))].sort((a, b) => a - b);
  const days = DAY_ORDER.filter((d) => timeSlots.some((s) => s.dayOfWeek === d));
  const slotByDayPeriod = new Map(
    timeSlots.map((s) => [`${s.dayOfWeek}-${s.periodNumber}`, s])
  );

  return (
    <section>
      <AutoGenerateButton
        classGroupId={selectedClassId}
        action={runAutoGenerate}
        error={error}
        notice={notice}
        classSelector={<ClassSelector classGroups={classGroups} selectedClassId={selectedClassId} />}
      />

      {timeSlots.length === 0 ? (
        <p className="text-sm text-gray-600">
          まずコマ(時限)を登録してください(「コマ」メニューから追加できます)。
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="border-collapse">
            <thead>
              <tr>
                <th className="border border-gray-200 px-2 py-1 text-xs bg-gray-50" />
                {days.map((d) => (
                  <th
                    key={d}
                    className="border border-gray-200 px-3 py-1 text-xs bg-gray-50 min-w-[160px]"
                  >
                    {DAY_LABELS[d]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {periods.map((period) => (
                <tr key={period}>
                  <th className="border border-gray-200 px-2 py-1 text-xs bg-gray-50">
                    {period}限
                  </th>
                  {days.map((d) => {
                    const slot = slotByDayPeriod.get(`${d}-${period}`);
                    if (!slot) {
                      return <td key={d} className="border border-gray-200 bg-gray-50" />;
                    }
                    const entry = entryBySlot.get(slot.id);
                    return (
                      <td key={d} className="border border-gray-200 align-top p-2 text-xs">
                        {entry ? (
                          <div>
                            <p className="font-medium">{entry.subject.name}</p>
                            <p className="text-gray-500">{entry.teacher.name}</p>
                            <p className="text-gray-500">{entry.room.name}</p>
                            <form action={removeEntry} className="mt-1">
                              <input type="hidden" name="id" value={entry.id} />
                              <input type="hidden" name="classGroupId" value={selectedClassId} />
                              <button
                                type="submit"
                                className="text-red-600 hover:underline cursor-pointer"
                              >
                                削除
                              </button>
                            </form>
                          </div>
                        ) : (
                          <form action={assignEntry} className="flex flex-col gap-1">
                            <input type="hidden" name="classGroupId" value={selectedClassId} />
                            <input type="hidden" name="timeSlotId" value={slot.id} />
                            <select
                              name="subjectId"
                              required
                              defaultValue=""
                              className="border border-gray-300 rounded px-1 py-0.5"
                            >
                              <option value="" disabled>
                                科目
                              </option>
                              {subjects.map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.name}
                                </option>
                              ))}
                            </select>
                            <select
                              name="teacherId"
                              required
                              defaultValue=""
                              className="border border-gray-300 rounded px-1 py-0.5"
                            >
                              <option value="" disabled>
                                教員
                              </option>
                              {teachers.map((t) => (
                                <option key={t.id} value={t.id}>
                                  {t.name}
                                </option>
                              ))}
                            </select>
                            <select
                              name="roomId"
                              required
                              defaultValue=""
                              className="border border-gray-300 rounded px-1 py-0.5"
                            >
                              <option value="" disabled>
                                教室
                              </option>
                              {rooms.map((r) => (
                                <option key={r.id} value={r.id}>
                                  {r.name}
                                </option>
                              ))}
                            </select>
                            <button
                              type="submit"
                              className="bg-black text-white rounded px-1 py-0.5 cursor-pointer"
                            >
                              割当
                            </button>
                          </form>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
