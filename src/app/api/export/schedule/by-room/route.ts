import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getDefaultOrganization } from "@/lib/org";
import { toCsv, csvDownloadHeaders, scheduleGridToCsvRows } from "@/lib/csv";

export async function GET() {
  const org = await getDefaultOrganization();

  const [rooms, timeSlots, entries] = await Promise.all([
    prisma.room.findMany({ where: { organizationId: org.id }, orderBy: { name: "asc" } }),
    prisma.timeSlot.findMany({ where: { organizationId: org.id } }),
    prisma.timetableEntry.findMany({
      where: { organizationId: org.id },
      include: { subject: true, classGroup: true, teacher: true },
    }),
  ]);

  const rows: string[][] = [];
  for (const room of rooms) {
    const byTimeSlot = new Map(
      entries.filter((e) => e.roomId === room.id).map((e) => [e.timeSlotId, e])
    );
    if (rows.length > 0) rows.push([]);
    rows.push([room.name]);
    rows.push(
      ...scheduleGridToCsvRows(timeSlots, (slotId) => {
        const e = byTimeSlot.get(slotId);
        return e ? [e.subject.name, e.classGroup.name, e.teacher.name] : null;
      })
    );
  }

  return new NextResponse(toCsv(rows), {
    headers: csvDownloadHeaders("教室別時間割.csv"),
  });
}
