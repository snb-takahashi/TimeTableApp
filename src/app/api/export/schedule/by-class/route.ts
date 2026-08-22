import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getDefaultOrganization } from "@/lib/org";
import { toCsv, csvDownloadHeaders, scheduleGridToCsvRows } from "@/lib/csv";

export async function GET() {
  const org = await getDefaultOrganization();

  const [classGroups, timeSlots, entries] = await Promise.all([
    prisma.classGroup.findMany({ where: { organizationId: org.id }, orderBy: { name: "asc" } }),
    prisma.timeSlot.findMany({ where: { organizationId: org.id } }),
    prisma.timetableEntry.findMany({
      where: { organizationId: org.id },
      include: { subject: true, teacher: true, room: true },
    }),
  ]);

  const rows: string[][] = [];
  for (const classGroup of classGroups) {
    const byTimeSlot = new Map(
      entries.filter((e) => e.classGroupId === classGroup.id).map((e) => [e.timeSlotId, e])
    );
    if (rows.length > 0) rows.push([]);
    rows.push([classGroup.name]);
    rows.push(
      ...scheduleGridToCsvRows(timeSlots, (slotId) => {
        const e = byTimeSlot.get(slotId);
        return e ? [e.subject.name, e.teacher.name, e.room.name] : null;
      })
    );
  }

  return new NextResponse(toCsv(rows), {
    headers: csvDownloadHeaders("クラス別時間割.csv"),
  });
}
