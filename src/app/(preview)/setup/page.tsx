import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageIntro } from "@/components/marketing/page-intro";
import { PreviewNotice } from "@/components/preview/preview-notice";

export const metadata: Metadata = { title: "Setup preview" };
const steps = [
  { title: "Your service details", description: "Your selected service and activation information will appear here. No service is loaded in this preview." },
  { title: "Instructions for your device", description: "Device-specific guidance will be provided after the service integration is ready. No downloads or connection links are available here." },
  { title: "Continue to your service", description: "Your dashboard will bring together the next steps. This preview cannot provision access or verify a connection." },
];
export default function SetupPage() { return <div className="page-container content-page"><PageIntro eyebrow="GETTING STARTED / PREVIEW" title="A place to find your way."><p>A preview of the planned setup journey for Secure Access. These steps are informational and cannot be completed yet.</p></PageIntro><PreviewNotice>No activation, access keys, server connections, or device configuration are available. This page has no connection to a live VPN service.</PreviewNotice><div className="setup-steps">{steps.map((step,i) => <section className="setup-step" key={step.title}><span>0{i+1}</span><div><h2>{step.title}</h2><p>{step.description}</p></div></section>)}</div><Link className="text-link mt-7 gap-2 text-sm" href="/dashboard/secure-access"><ArrowLeft size={15} aria-hidden="true" />Back to service preview</Link></div>; }
