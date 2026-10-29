import { Badge, cn } from "@/components/ui/primitives";
import {
  DOCUMENT_REQUIREMENT_LABELS,
  DOCUMENT_REVIEW_STATUS_LABELS,
  type ApplicationStatus,
  type AppointmentStatus,
  type DocumentRequirement,
  type DocumentReviewStatus,
} from "@/lib/domain/constants";

type Tone = "neutral" | "info" | "success" | "warning" | "danger";

const APPLICATION_TONES: Record<ApplicationStatus, Tone> = {
  draft: "neutral",
  submitted: "info",
  in_review: "info",
  awaiting_customer: "warning",
  documents_complete: "success",
  awaiting_result: "info",
  result_communicated: "success",
  cancelled: "neutral",
};

const APPOINTMENT_TONES: Record<AppointmentStatus, Tone> = {
  not_started: "neutral",
  preferences_submitted: "info",
  preferences_requested: "warning",
  scheduled: "success",
  completed: "success",
};

const REVIEW_TONES: Record<DocumentReviewStatus, Tone> = {
  pending: "neutral",
  approved: "success",
  needs_correction: "warning",
  missing: "danger",
};

/** Document rule badges are filled and distinct: required red, optional green. */
const REQUIREMENT_CLASSES: Record<DocumentRequirement, string> = {
  required: "border-accent-600 bg-accent-600 text-white",
  optional: "border-emerald-700 bg-emerald-700 text-white",
};

/** Color tone of the application status (the label in the application steps' header uses the same tone). */
export function applicationStatusTone(status: ApplicationStatus): Tone {
  return APPLICATION_TONES[status];
}

/** Color tone of the appointment status. */
export function appointmentStatusTone(status: AppointmentStatus): Tone {
  return APPOINTMENT_TONES[status];
}

export function DocumentReviewBadge({ status }: { status: DocumentReviewStatus }) {
  return <Badge tone={REVIEW_TONES[status]}>{DOCUMENT_REVIEW_STATUS_LABELS[status]}</Badge>;
}

export function RequirementBadge({ requirement }: { requirement: DocumentRequirement }) {
  return (
    <span className={cn("inline-flex items-center rounded border px-2 py-0.5 text-xs font-semibold leading-5", REQUIREMENT_CLASSES[requirement])}>
      {DOCUMENT_REQUIREMENT_LABELS[requirement]}
    </span>
  );
}
