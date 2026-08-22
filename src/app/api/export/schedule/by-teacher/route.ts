import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getDefaultOrganization } from "@/lib/org";
import { toCsv, csvDownloadHeaders, scheduleGridToCsvRows } from "@/lib/csv";

export async function GET() {
  const org = await getDefaultOrganization();

  const [teachers, timeSlots, entries] = await Promise.all([
    prisma.teacher.findMany({ where: { organizationId: org.id }, orderBy: { name: "asc" } }),
    prisma.timeSlot.findMany({ where: { organizationId: org.id } }),
    prisma.timetableEntry.findMany({
      where: { organizationId: org.id },
      include: { subject: true, classGroup: true, room: true },
    }),
  ]);

  const rows: string[][] = [];
  for (const teacher of teachers) {
    const byTimeSlot = new Map(
      entries.filter((e) => e.teacherId === teacher.id).map((e) => [e.timeSlotId, e])
    );
    if (rows.length > 0) rows.push([]);
    rows.push([teacher.name]);
    rows.push(
      ...scheduleGridToCsvRows(timeSlots, (slotId) => {
        const e = byTimeSlot.get(slotId);
        return e ? [e.subject.name, e.classGroup.name, e.room.name] : null;
      })
    );
  }

  return new NextResponse(toCsv(rows), {
    headers: csvDownloadHeaders("教員別時間割.csv"),
  });
}
