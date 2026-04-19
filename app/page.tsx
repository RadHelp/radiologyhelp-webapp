"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Mic,
  Upload,
  FileText,
  LogOut,
  Shield,
  Lock,
  Square,
  CheckCircle2,
  AlertCircle,
  Keyboard,
  Wand2,
  Copy,
  ClipboardPaste,
  Footprints,
  ImagePlus,
  Sparkles,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const VOICE_COMMANDS = [
  '"new paragraph"',
  '"next section"',
  '"history colon"',
  '"technique colon"',
  '"findings colon"',
  '"impression colon"',
  '"full stop"',
  '"insert normal CT brain template"',
];

const RADIOLOGY_REPLACEMENTS: Array<[RegExp, string]> = [
  [/basal cystons/gi, "basal cisterns"],
  [/acute cortical grammar infarcts/gi, "acute cortical infarcts"],
  [/haemorage|hemorage/gi, "haemorrhage"],
  [/maxillary antrim/gi, "maxillary antrum"],
  [/mucosal thicking/gi, "mucosal thickening"],
  [/retro orbital/gi, "retro-orbital"],
];

const NORMAL_CT_BRAIN_TEMPLATE = `History:

Technique:
Non-contrast CT brain.

Findings:
There is no acute intracranial haemorrhage. No mass effect or midline shift. Ventricles and basal cisterns are patent. No acute territorial infarct is identified on this examination. The calvarium is intact.

Impression:
No acute intracranial abnormality.`;

type UserType = {
  email: string;
  name: string;
  role: string;
} | null;

type PastedImage = {
  id: string;
  file: File;
  name: string;
  previewUrl: string;
};

export default function RadiologyTranscriptionWebApp() {
  const [user, setUser] = useState<UserType>(null);
  const [loginEmail, setLoginEmail] = useState("radiologist@clinic.com");
  const [loginPassword, setLoginPassword] = useState("password123");
  const [rememberMe, setRememberMe] = useState(true);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [pastedImages, setPastedImages] = useState<PastedImage[]>([]);
  const [imageIntakeMode, setImageIntakeMode] = useState("auto-report");
  const [isUploading, setIsUploading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [formattedReport, setFormattedReport] = useState("");
  const [historyText, setHistoryText] = useState("Headache and dizziness. Exclude acute intracranial pathology.");
  const [modality, setModality] = useState("CT Brain");
  const [templateMode, setTemplateMode] = useState("standard");
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const [dictateMode, setDictateMode] = useState("one-tap");
  const [autoCorrectTerms, setAutoCorrectTerms] = useState(true);
  const [showCommandHints, setShowCommandHints] = useState(true);
  const [footPedalMode, setFootPedalMode] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const pasteZoneRef = useRef<HTMLDivElement | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const isSpaceHeldRef = useRef(false);

  const reportPrompt = useMemo(() => {
    return `You are a radiology transcription assistant. Convert dictated clinical audio into a clean radiology report with these rules:

- Preserve medical meaning exactly.
- Expand punctuation words like stop/new line/full stop/next section into proper formatting.
- Map voice commands such as history colon, technique colon, findings colon, impression colon into section headings.
- If asked to insert a normal template, create an appropriate normal template for the stated modality without inventing abnormal findings.
- Use headings: History, Technique, Findings, Impression.
- Leave one blank line between sections.
- Fix obvious speech recognition errors only when context is clear.
- Keep style concise, professional, and suitable for radiology reporting.
- Do not invent findings that were not stated unless the speaker explicitly asked for a normal template.
- Modality: ${modality}
- Template style: ${templateMode}
- Clinical history: ${historyText}`;
  }, [historyText, modality, templateMode]);

  const normaliseTranscript = (text: string) => {
    if (!text) return "";
    let next = text;

    RADIOLOGY_REPLACEMENTS.forEach(([pattern, replacement]) => {
      next = next.replace(pattern, replacement);
    });

    next = next
      .replace(/\bnew paragraph\b/gi, "\n\n")
      .replace(/\bnext section\b/gi, "\n\n")
      .replace(/\bfull stop\b/gi, ".")
      .replace(/\bstop\b/gi, ".")
      .replace(/\bhistory colon\b/gi, "History:")
      .replace(/\btechnique colon\b/gi, "Technique:")
      .replace(/\bfindings colon\b/gi, "Findings:")
      .replace(/\bimpression colon\b/gi, "Impression:")
      .replace(/\s+\./g, ".")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    return next;
  };

  const applyLocalFormatting = (rawTranscript: string, aiFormattedReport = "") => {
    const cleanedTranscript = autoCorrectTerms ? normaliseTranscript(rawTranscript) : rawTranscript;
    let nextReport = aiFormattedReport?.trim() || cleanedTranscript;

    if (autoCorrectTerms) {
      nextReport = normaliseTranscript(nextReport);
    }

    if (/insert normal CT brain template/i.test(cleanedTranscript) && !/History:/i.test(nextReport)) {
      nextReport = NORMAL_CT_BRAIN_TEMPLATE.replace("History:\n\n", `History:\n${historyText || ""}\n\n`);
    }

    return {
      cleanedTranscript,
      cleanedReport: nextReport,
    };
  };

  const fileToDataUrl = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const addImageFiles = async (files: File[]) => {
    const imageFiles = files.filter((file) => file.type.startsWith("image/"));
    if (!imageFiles.length) return;

    const nextImages = await Promise.all(
      imageFiles.map(async (file, index) => ({
        id: `${Date.now()}-${index}-${file.name}`,
        file,
        name: file.name,
        previewUrl: await fileToDataUrl(file),
      }))
    );

    setPastedImages((prev) => [...prev, ...nextImages]);
    setStatus("images-ready");
    setError("");
  };

  const removePastedImage = (id: string) => {
    setPastedImages((prev) => prev.filter((image) => image.id !== id));
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoggingIn(true);
    setError("");

    try {
      await new Promise((resolve) => setTimeout(resolve, 700));
      setUser({
        email: loginEmail,
        name: "Dr Jackson",
        role: "Radiologist",
      });
    } catch {
      setError("Login failed. Please try again.");
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = () => {
    setUser(null);
    setTranscript("");
    setFormattedReport("");
    setAudioFile(null);
    setPastedImages([]);
    setStatus("idle");
    setError("");
    setCopyStatus("");
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAudioFile(file);
    setStatus("file-selected");
    setError("");
  };

  const handleImageFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    await addImageFiles(files);
    e.target.value = "";
  };

  const handlePasteIntoZone = async (event: ClipboardEvent | React.ClipboardEvent<HTMLDivElement>) => {
    const items = Array.from(event.clipboardData?.items || []);
    const files = items
      .filter((item) => item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter(Boolean) as File[];

    if (!files.length) return;

    event.preventDefault();
    await addImageFiles(files);
  };

  const beginRecorderSession = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream);
    recordedChunksRef.current = [];
    streamRef.current = stream;

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) recordedChunksRef.current.push(event.data);
    };

    mediaRecorderRef.current = recorder;
    recorder.start();
    setIsRecording(true);
    setStatus("recording");
  };

  const transcribeFile = async (file: File) => {
    try {
      setIsUploading(true);
      setStatus("transcribing");
      setError("");

      const formData = new FormData();
      formData.append("audio", file);
      formData.append("prompt", reportPrompt);
      formData.append("history", historyText);
      formData.append("modality", modality);
      formData.append("templateMode", templateMode);

      const response = await fetch("/api/transcribe-report", {
        method: "POST",
        body: formData,
        credentials: "include",
      });

      if (!response.ok) throw new Error("Transcription request failed");

      const data = await response.json();
      const { cleanedTranscript, cleanedReport } = applyLocalFormatting(
        data.rawTranscript || "",
        data.formattedReport || ""
      );
      setTranscript(cleanedTranscript);
      setFormattedReport(cleanedReport);
      setStatus("done");
    } catch {
      setStatus("error");
      setError("Unable to transcribe right now. Check your backend route and OpenAI credentials.");
    } finally {
      setIsUploading(false);
    }
  };

  const generateReportFromImages = async () => {
    if (!pastedImages.length) {
      setError("Paste or upload at least one referral or worksheet image first.");
      return;
    }

    try {
      setIsUploading(true);
      setStatus("generating-report-from-images");
      setError("");

      const formData = new FormData();
      pastedImages.forEach((image) => {
        formData.append("images", image.file);
      });
      formData.append("history", historyText);
      formData.append("modality", modality);
      formData.append("templateMode", templateMode);
      formData.append("imageIntakeMode", imageIntakeMode);
      formData.append(
        "prompt",
        `You are a radiology reporting assistant. Review the uploaded referral form, ultrasound worksheet, or scanned notes and draft a radiology report. Use only information visible in the images and the provided clinical history. If key details are missing, keep the report conservative and do not invent findings. Return a concise report with headings History, Technique, Findings, Impression. Modality: ${modality}. Template style: ${templateMode}. Clinical history: ${historyText}`
      );

      const response = await fetch("/api/generate-report-from-images", {
        method: "POST",
        body: formData,
        credentials: "include",
      });

      if (!response.ok) throw new Error("Image report request failed");

      const data = await response.json();
      const sourceSummary = data.sourceSummary || "";
      const draftedReport = data.formattedReport || "";
      const { cleanedTranscript, cleanedReport } = applyLocalFormatting(sourceSummary, draftedReport);
      setTranscript(cleanedTranscript || "Image-based report generation completed.");
      setFormattedReport(cleanedReport);
      setStatus("done");
    } catch {
      setStatus("error");
      setError("Unable to generate a report from the pasted images right now. Check your backend image route and model settings.");
    } finally {
      setIsUploading(false);
    }
  };

  const startRecording = async () => {
    setError("");
    try {
      await beginRecorderSession();
    } catch {
      setError("Microphone access was blocked. Please allow mic access or upload an audio file.");
    }
  };

  const stopRecording = () => {
    if (!mediaRecorderRef.current || !isRecording) return;

    setStatus("processing-dictation");
    mediaRecorderRef.current.onstop = async () => {
      const blob = new Blob(recordedChunksRef.current, { type: "audio/webm" });
      const file = new File([blob], `dictation-${Date.now()}.webm`, { type: "audio/webm" });
      setAudioFile(file);
      setIsRecording(false);
      streamRef.current?.getTracks()?.forEach((track) => track.stop());
      streamRef.current = null;

      if (dictateMode === "one-tap" || dictateMode === "push-to-talk") {
        await transcribeFile(file);
      } else {
        setStatus("recorded");
      }
    };

    mediaRecorderRef.current.stop();
  };

  const toggleDictation = async () => {
    if (isRecording) {
      stopRecording();
    } else {
      await startRecording();
    }
  };

  const transcribeAudio = async () => {
    if (!audioFile) {
      setError("Please upload or record an audio file first.");
      return;
    }

    await transcribeFile(audioFile);
  };

  const copyReport = async () => {
    if (!formattedReport) return;
    await navigator.clipboard.writeText(formattedReport);
    setCopyStatus("Report copied");
    setTimeout(() => setCopyStatus(""), 2000);
  };

  const pasteToReport = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setFormattedReport((prev) => (prev ? `${prev}\n\n${text}` : text));
      }
    } catch {
      setError("Clipboard access was blocked by the browser.");
    }
  };

  const insertTemplate = () => {
    setFormattedReport(NORMAL_CT_BRAIN_TEMPLATE.replace("History:\n\n", `History:\n${historyText || ""}\n\n`));
    setStatus("template-loaded");
  };

  const demoFill = () => {
    const raw =
      "CT head history colon headache full stop technique colon non contrast CT head full stop findings colon there is no acute intracranial haemorrhage full stop no midline shift full stop ventricles are normal in size full stop mild mucosal thickening in the right maxillary sinus full stop impression colon no acute intracranial abnormality full stop mild right maxillary sinus mucosal thickening full stop";
    const report =
      "History:\nHeadache.\n\nTechnique:\nNon-contrast CT head.\n\nFindings:\nThere is no acute intracranial haemorrhage. No midline shift. Ventricles are normal in size. Mild mucosal thickening in the right maxillary sinus.\n\nImpression:\nNo acute intracranial abnormality. Mild right maxillary sinus mucosal thickening.";

    const { cleanedTranscript, cleanedReport } = applyLocalFormatting(raw, report);
    setTranscript(cleanedTranscript);
    setFormattedReport(cleanedReport);
    setStatus("done");
    setError("");
  };

  useEffect(() => {
    if (!footPedalMode || !user) return;

    const onKeyDown = async (event: KeyboardEvent) => {
      if (event.code !== "Space" || isSpaceHeldRef.current) return;
      const targetTag = (event.target as HTMLElement | null)?.tagName?.toLowerCase();
      if (targetTag === "input" || targetTag === "textarea") return;
      event.preventDefault();
      isSpaceHeldRef.current = true;
      if (!isRecording) {
        await startRecording();
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== "Space") return;
      isSpaceHeldRef.current = false;
      if (isRecording) {
        stopRecording();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [footPedalMode, user, isRecording, historyText, modality, templateMode]);

  useEffect(() => {
    const handleWindowPaste = async (event: ClipboardEvent) => {
      const active = document.activeElement;
      const tag = active?.tagName?.toLowerCase();
      const inEditableField = tag === "input" || tag === "textarea";
      if (inEditableField) return;
      await handlePasteIntoZone(event);
    };

    window.addEventListener("paste", handleWindowPaste);
    return () => window.removeEventListener("paste", handleWindowPaste);
  }, []);

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-950 p-6 text-white md:p-10">
        <div className="mx-auto grid min-h-[85vh] max-w-6xl items-center gap-8 lg:grid-cols-2">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45 }}
          >
            <Badge className="mb-4 rounded-full px-4 py-1 text-sm">Radiology AI Workspace</Badge>
            <h1 className="text-4xl font-semibold leading-tight tracking-tight md:text-6xl">
              Secure dictation and report transcription for radiology.
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-8 text-slate-300">
              A login-protected web app that accepts microphone dictation or uploaded audio, sends it to a secure backend, and returns a structured radiology report.
            </p>

            <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Card className="rounded-2xl border-slate-800 bg-slate-900">
                <CardContent className="p-5">
                  <Shield className="mb-3 h-5 w-5" />
                  <div className="font-medium">Authenticated access</div>
                  <div className="mt-2 text-sm text-slate-400">Restrict report creation to approved users.</div>
                </CardContent>
              </Card>
              <Card className="rounded-2xl border-slate-800 bg-slate-900">
                <CardContent className="p-5">
                  <Mic className="mb-3 h-5 w-5" />
                  <div className="font-medium">Live dictation workflow</div>
                  <div className="mt-2 text-sm text-slate-400">Record audio directly in the browser.</div>
                </CardContent>
              </Card>
              <Card className="rounded-2xl border-slate-800 bg-slate-900">
                <CardContent className="p-5">
                  <FileText className="mb-3 h-5 w-5" />
                  <div className="font-medium">Structured reports</div>
                  <div className="mt-2 text-sm text-slate-400">Format output into History, Technique, Findings, and Impression.</div>
                </CardContent>
              </Card>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.1 }}
          >
            <Card className="rounded-[28px] border-slate-800 bg-white text-slate-900 shadow-2xl">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2 text-sm text-slate-500">
                  <Lock className="h-4 w-4" /> Secure sign in
                </div>
                <CardTitle className="text-2xl">Welcome back</CardTitle>
                <CardDescription>Use your clinic login to access the transcription workspace.</CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleLogin} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input id="email" value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="password">Password</Label>
                    <Input id="password" type="password" value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} />
                  </div>

                  <label className="flex items-center gap-3 text-sm text-slate-600">
                    <input type="checkbox" checked={rememberMe} onChange={() => setRememberMe(!rememberMe)} />
                    Keep me signed in on this device
                  </label>

                  {error ? (
                    <div className="flex gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                      <AlertCircle className="mt-0.5 h-4 w-4" /> {error}
                    </div>
                  ) : null}

                  <Button className="h-11 w-full rounded-xl" disabled={isLoggingIn}>
                    {isLoggingIn ? "Signing in..." : "Sign in"}
                  </Button>
                </form>

                <Separator className="my-6" />

                <div className="text-sm leading-6 text-slate-500">
                  Demo login only in this preview. In production, replace this with Supabase Auth, Clerk, Auth0, or your clinic SSO.
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 p-4 md:p-8">
      <div className="mx-auto max-w-7xl">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between"
        >
          <div>
            <div className="text-sm text-slate-500">Signed in as {user.email}</div>
            <h1 className="text-3xl font-semibold tracking-tight">Radiology Report Transcription</h1>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Badge className="rounded-full px-3 py-1">{user.role}</Badge>
            <Badge variant="outline" className="rounded-full px-3 py-1">
              {dictateMode === "push-to-talk" ? "Push-to-talk" : "One-tap dictate"}
            </Badge>
            <Button variant="outline" className="rounded-xl" onClick={handleLogout}>
              <LogOut className="mr-2 h-4 w-4" /> Logout
            </Button>
          </div>
        </motion.div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.05fr_1.25fr]">
          <Card className="rounded-[24px] border-0 shadow-sm">
            <CardHeader>
              <CardTitle>Input</CardTitle>
              <CardDescription>Set the study context, then upload or dictate straight into the app.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Modality / Study</Label>
                  <Input value={modality} onChange={(e) => setModality(e.target.value)} placeholder="CT Brain" />
                </div>
                <div className="space-y-2">
                  <Label>Template mode</Label>
                  <Input value={templateMode} onChange={(e) => setTemplateMode(e.target.value)} placeholder="standard" />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Clinical history</Label>
                <Textarea value={historyText} onChange={(e) => setHistoryText(e.target.value)} className="min-h-[100px]" />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="flex cursor-pointer items-start gap-3 rounded-2xl border bg-white p-4">
                  <input type="radio" className="mt-1" checked={dictateMode === "one-tap"} onChange={() => setDictateMode("one-tap")} />
                  <div>
                    <div className="font-medium">One-tap dictate</div>
                    <div className="mt-1 text-sm text-slate-500">Click once to start. Click again to stop and auto-transcribe.</div>
                  </div>
                </label>
                <label className="flex cursor-pointer items-start gap-3 rounded-2xl border bg-white p-4">
                  <input type="radio" className="mt-1" checked={dictateMode === "push-to-talk"} onChange={() => setDictateMode("push-to-talk")} />
                  <div>
                    <div className="font-medium">Push-to-talk</div>
                    <div className="mt-1 text-sm text-slate-500">Use the big button or hold Space like a foot pedal.</div>
                  </div>
                </label>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <label className="flex cursor-pointer items-start gap-3 rounded-2xl border bg-white p-4">
                  <input type="checkbox" className="mt-1" checked={autoCorrectTerms} onChange={() => setAutoCorrectTerms(!autoCorrectTerms)} />
                  <div>
                    <div className="flex items-center gap-2 font-medium">
                      <Wand2 className="h-4 w-4" /> Auto-correct terms
                    </div>
                    <div className="mt-1 text-sm text-slate-500">Clean common speech-to-text radiology mistakes locally.</div>
                  </div>
                </label>
                <label className="flex cursor-pointer items-start gap-3 rounded-2xl border bg-white p-4">
                  <input type="checkbox" className="mt-1" checked={showCommandHints} onChange={() => setShowCommandHints(!showCommandHints)} />
                  <div>
                    <div className="flex items-center gap-2 font-medium">
                      <Keyboard className="h-4 w-4" /> Voice command hints
                    </div>
                    <div className="mt-1 text-sm text-slate-500">Show supported reporting phrases on screen.</div>
                  </div>
                </label>
                <label className="flex cursor-pointer items-start gap-3 rounded-2xl border bg-white p-4">
                  <input type="checkbox" className="mt-1" checked={footPedalMode} onChange={() => setFootPedalMode(!footPedalMode)} />
                  <div>
                    <div className="flex items-center gap-2 font-medium">
                      <Footprints className="h-4 w-4" /> Spacebar pedal
                    </div>
                    <div className="mt-1 text-sm text-slate-500">Hold Space to dictate, release to transcribe.</div>
                  </div>
                </label>
              </div>

              <div className="rounded-2xl border bg-slate-50 p-4">
                <div className="mb-3 text-sm font-medium">Formatting prompt sent to backend</div>
                <pre className="whitespace-pre-wrap text-xs leading-5 text-slate-600">{reportPrompt}</pre>
              </div>

              {showCommandHints ? (
                <div className="rounded-2xl border bg-white p-4">
                  <div className="mb-3 font-medium">Voice commands</div>
                  <div className="flex flex-wrap gap-2">
                    {VOICE_COMMANDS.map((command) => (
                      <Badge key={command} variant="outline" className="rounded-full px-3 py-1">
                        {command}
                      </Badge>
                    ))}
                  </div>
                </div>
              ) : null}

              <Tabs defaultValue="record" className="w-full">
                <TabsList className="grid w-full grid-cols-3 rounded-xl">
                  <TabsTrigger value="record">Dictate into app</TabsTrigger>
                  <TabsTrigger value="upload">Upload audio</TabsTrigger>
                  <TabsTrigger value="images">Referral / worksheet images</TabsTrigger>
                </TabsList>

                <TabsContent value="record" className="space-y-4 pt-4">
                  <div className="rounded-2xl border bg-white p-6 text-center">
                    <Button className="h-24 w-24 rounded-full p-0 text-white" onClick={toggleDictation} disabled={isUploading}>
                      {isRecording ? <Square className="h-10 w-10" /> : <Mic className="h-10 w-10" />}
                    </Button>
                    <div className="mt-4 text-lg font-medium">{isRecording ? "Recording now" : "Tap to dictate"}</div>
                    <div className="mx-auto mt-2 max-w-md text-sm text-slate-500">
                      {isRecording
                        ? "Click again to stop. The app will transcribe and format the report automatically."
                        : footPedalMode
                          ? "You can also hold the Spacebar to dictate and release to transcribe."
                          : "Ideal for straight radiology dictation into the report workflow."}
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="upload" className="space-y-4 pt-4">
                  <label className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed bg-white p-8 text-center">
                    <Upload className="mb-3 h-8 w-8" />
                    <div className="font-medium">Click to upload audio</div>
                    <div className="mt-1 text-sm text-slate-500">Supports common formats like MP3, WAV, M4A, or WebM.</div>
                    <input type="file" accept="audio/*" className="hidden" onChange={handleFileChange} />
                  </label>
                </TabsContent>

                <TabsContent value="images" className="space-y-4 pt-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="flex cursor-pointer items-start gap-3 rounded-2xl border bg-white p-4">
                      <input type="radio" className="mt-1" checked={imageIntakeMode === "auto-report"} onChange={() => setImageIntakeMode("auto-report")} />
                      <div>
                        <div className="font-medium">Auto-generate report</div>
                        <div className="mt-1 text-sm text-slate-500">Send pasted forms or worksheets to the backend and draft a report automatically.</div>
                      </div>
                    </label>
                    <label className="flex cursor-pointer items-start gap-3 rounded-2xl border bg-white p-4">
                      <input type="radio" className="mt-1" checked={imageIntakeMode === "summary-first"} onChange={() => setImageIntakeMode("summary-first")} />
                      <div>
                        <div className="font-medium">Summary-first</div>
                        <div className="mt-1 text-sm text-slate-500">Extract worksheet details, then draft a conservative report from them.</div>
                      </div>
                    </label>
                  </div>

                  <div
                    ref={pasteZoneRef}
                    tabIndex={0}
                    onPaste={handlePasteIntoZone}
                    className="rounded-2xl border-2 border-dashed bg-white p-8 text-center outline-none focus:ring-2 focus:ring-slate-300"
                  >
                    <ImagePlus className="mx-auto mb-3 h-8 w-8" />
                    <div className="font-medium">Paste referral forms or ultrasound worksheets here</div>
                    <div className="mt-1 text-sm text-slate-500">Click this box and press Cmd/Ctrl + V, or upload image files below.</div>
                    <div className="mt-4">
                      <label className="inline-flex cursor-pointer items-center rounded-xl border px-4 py-2 text-sm font-medium">
                        <Upload className="mr-2 h-4 w-4" /> Upload images
                        <input type="file" accept="image/*" multiple className="hidden" onChange={handleImageFileChange} />
                      </label>
                    </div>
                  </div>

                  {pastedImages.length ? (
                    <div className="rounded-2xl border bg-white p-4">
                      <div className="mb-3 flex items-center gap-2 font-medium">
                        <Sparkles className="h-4 w-4" /> Image queue
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {pastedImages.map((image) => (
                          <div key={image.id} className="rounded-2xl border p-3">
                            <img src={image.previewUrl} alt={image.name} className="h-32 w-full rounded-xl bg-slate-100 object-cover" />
                            <div className="mt-2 truncate text-sm text-slate-600">{image.name}</div>
                            <Button variant="outline" className="mt-3 w-full rounded-xl" onClick={() => removePastedImage(image.id)}>
                              Remove
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <div className="flex flex-wrap gap-3">
                    <Button onClick={generateReportFromImages} disabled={isUploading} className="rounded-xl">
                      {isUploading ? "Generating report..." : "Generate report from images"}
                    </Button>
                    <Button variant="outline" className="rounded-xl" onClick={() => setPastedImages([])}>
                      Clear images
                    </Button>
                  </div>
                </TabsContent>
              </Tabs>

              {audioFile ? (
                <div className="flex items-start gap-3 rounded-2xl border bg-emerald-50 p-4 text-sm text-emerald-800">
                  <CheckCircle2 className="mt-0.5 h-4 w-4" />
                  <div>
                    <div className="font-medium">Audio ready</div>
                    <div>{audioFile.name}</div>
                  </div>
                </div>
              ) : null}

              {error ? (
                <div className="rounded-2xl border bg-red-50 p-4 text-sm text-red-700">{error}</div>
              ) : null}

              <div className="flex flex-wrap gap-3">
                <Button onClick={transcribeAudio} disabled={isUploading} className="rounded-xl">
                  {isUploading ? "Transcribing..." : "Transcribe uploaded audio"}
                </Button>
                <Button variant="outline" onClick={insertTemplate} className="rounded-xl">
                  Insert normal CT brain template
                </Button>
                <Button variant="outline" onClick={demoFill} className="rounded-xl">
                  Load demo result
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-[24px] border-0 shadow-sm">
            <CardHeader>
              <CardTitle>Output</CardTitle>
              <CardDescription>Raw transcript and cleaned radiology report.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-5 lg:grid-cols-2">
                <div className="space-y-2">
                  <Label>Raw transcript</Label>
                  <Textarea
                    value={transcript}
                    onChange={(e) => setTranscript(e.target.value)}
                    className="min-h-[460px] bg-slate-50"
                    placeholder="The raw transcription will appear here..."
                  />
                </div>
                <div className="space-y-2">
                  <Label>Formatted report</Label>
                  <Textarea
                    value={formattedReport}
                    onChange={(e) => setFormattedReport(e.target.value)}
                    className="min-h-[460px] bg-slate-50 font-mono"
                    placeholder="The structured radiology report will appear here..."
                  />
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-3">
                <Button variant="outline" className="rounded-xl" onClick={copyReport}>
                  <Copy className="mr-2 h-4 w-4" /> Copy report
                </Button>
                <Button variant="outline" className="rounded-xl" onClick={pasteToReport}>
                  <ClipboardPaste className="mr-2 h-4 w-4" /> Paste into report
                </Button>
                {copyStatus ? <Badge className="rounded-full px-3 py-1">{copyStatus}</Badge> : null}
              </div>

              <Separator className="my-5" />

              <div className="grid gap-4 md:grid-cols-3">
                <div className="rounded-2xl border bg-white p-4">
                  <div className="text-sm text-slate-500">Status</div>
                  <div className="mt-1 font-medium capitalize">{status.replaceAll("-", " ")}</div>
                </div>
                <div className="rounded-2xl border bg-white p-4">
                  <div className="text-sm text-slate-500">Authentication</div>
                  <div className="mt-1 font-medium">Session-based</div>
                </div>
                <div className="rounded-2xl border bg-white p-4">
                  <div className="text-sm text-slate-500">OpenAI integration</div>
                  <div className="mt-1 font-medium">Backend route only</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="mt-6 rounded-[24px] border-0 shadow-sm">
          <CardHeader>
            <CardTitle>Backend contract</CardTitle>
            <CardDescription>Expected server routes for audio dictation and image-driven report drafting.</CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="overflow-x-auto rounded-2xl bg-slate-950 p-5 text-xs leading-6 text-slate-100">
              {`POST /api/transcribe-report

FormData fields:
- audio: File
- prompt: string
- history: string
- modality: string
- templateMode: string

Suggested response JSON:
{
  "rawTranscript": "...",
  "formattedReport": "History:\\n...\\n\\nTechnique:\\n...\\n\\nFindings:\\n...\\n\\nImpression:\\n..."
}

POST /api/generate-report-from-images

FormData fields:
- images: File[]
- prompt: string
- history: string
- modality: string
- templateMode: string
- imageIntakeMode: string

Suggested response JSON:
{
  "sourceSummary": "Key worksheet/referral details extracted from the image set",
  "formattedReport": "History:\\n...\\n\\nTechnique:\\n...\\n\\nFindings:\\n...\\n\\nImpression:\\n..."
}`}
            </pre>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
