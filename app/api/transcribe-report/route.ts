import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    return NextResponse.json({
      rawTranscript: "Demo dictated transcript",
      formattedReport: `History:
Headache.

Technique:
Non-contrast CT brain.

Findings:
No acute intracranial haemorrhage.

Impression:
Normal CT brain.`
    });
  } catch (e) {
    return NextResponse.json(
      { error: "Transcription failed" },
      { status: 500 }
    );
  }
}