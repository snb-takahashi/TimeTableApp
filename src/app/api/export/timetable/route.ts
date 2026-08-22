import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getDefaultOrganization } from "@/lib/org";
import { toCsv, csvDownloadHeaders, scheduleGridToCsvRows } from "@/lib/csv";

export async function GET(request: Request) {
  const org = await getDefaultOrganization();
  const classId = new URL(request.url).searchParams.get("classId");
  if (!classId) {
    return NextResponse.json({ error: "classId is required" }, { status: 400 });
  }

  const [classGroup, timeSlots, entries] = await Promise.all([
    prisma.classGroup.findFirst({ where: { id: classId, organizationId: org.id } }),
    prisma.timeSlot.findMany({ where: { organizationId: org.id } }),
    prisma.timetableEntry.findMany({
      where: { organizationId: org.id, classGroupId: classId },
      include: { subject: true, teacher: true, room: true },
    }),
  ]);

  if (!classGroup) {
    return NextResponse.json({ error: "class not found" }, { status: 404 });
  }

  const entryBySlot = new Map(entries.map((e) => [e.timeSlotId, e]));
  const rows = scheduleGridToCsvRows(timeSlots, (slotId) => {
    const e = entryBySlot.get(slotId);
    return e ? [e.subject.name, e.teacher.name, e.room.name] : null;
  });

  return new NextResponse(toCsv(rows), {
    headers: csvDownloadHeaders(`${classGroup.name}_時間割.csv`),
  });
}
