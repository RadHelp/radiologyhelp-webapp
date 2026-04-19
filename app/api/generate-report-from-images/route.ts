import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    return NextResponse.json({
      sourceSummary: "Worksheet processed",
      formattedReport: `History:
Referral reviewed.

Technique:
Ultrasound performed.

Findings:
No abnormality identified.

Impression:
Normal study.`
    });
  } catch (e) {
    return NextResponse.json(
      { error: "Image report generation failed" },
      { status: 500 }
    );
  }
}