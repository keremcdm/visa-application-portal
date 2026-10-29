import type {
  AllowedMimeType,
  ApplicationStatus,
  ApplicationType,
  AppointmentSlot,
  AppointmentStatus,
  Currency,
  DocumentRequirement,
  DocumentReviewStatus,
  FileKind,
  PaymentStatus,
  SponsorStatus,
  VisaOutcome,
} from "@/lib/domain/constants";

/** Verified and narrowed data types (DTOs) the server passes to the UI. */

export type Application = {
  id: string;
  referenceCode: string;
  customerId: string;
  applicationTypes: ApplicationType[];
  sponsorStatus: SponsorStatus | null;
  cityId: string | null;
  status: ApplicationStatus;
  formLocked: boolean;
  paymentStatus: PaymentStatus;
  paymentDeclaredAt: string | null;
  paymentReviewedAt: string | null;
  paymentNote: string | null;
  appointmentStatus: AppointmentStatus;
  appointmentAt: string | null;
  /** Name and address of the appointment location: a copy taken when it was picked from the list in Settings (migration 12; no address before). */
  appointmentLocation: string | null;
  appointmentAddress: string | null;
  appointmentLocationId: string | null;
  /** Google Maps link of the appointment location: a copy taken when it was picked from the location list (migration 17). */
  appointmentMapsUrl: string | null;
  appointmentNote: string | null;
  /** When the customer opened the Fee step in a draft (migration 17); the step's mark turns green accordingly. */
  feeStepSeenAt: string | null;
  /** The customer's form edit request and its text; cleared when the consultant opens the form or refuses (migration 17). */
  formEditRequestedAt: string | null;
  formEditRequestNote: string | null;
  submittedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ApplicationFile = {
  id: string;
  applicationId: string;
  documentId: string | null;
  kind: FileKind;
  originalName: string;
  mimeType: AllowedMimeType;
  sizeBytes: number;
  storagePath: string;
  createdAt: string;
};

export type DocumentSlot = {
  id: string;
  applicationId: string;
  documentTypeId: string | null;
  label: string;
  description: string;
  requirement: DocumentRequirement;
  maxFiles: number;
  outOfScope: boolean;
  reviewStatus: DocumentReviewStatus;
  reviewNote: string | null;
  reuploadAllowed: boolean;
  requestedByStaff: boolean;
  sortOrder: number;
  /** Only filled for staff (ZIP folder mapping). */
  zipFolderName: string | null;
  /** Document prepared by the company for the customer to download and sign. */
  attachment: ApplicationFile | null;
  files: ApplicationFile[];
};

export type AppointmentPreferenceRow = { rank: number; date: string; slot: AppointmentSlot };

/** `unread`: the customer has not read it yet (read state comes with migration 11; always false if not applied). */
export type Message = { id: string; body: string; createdAt: string; authorName: string | null; unread: boolean };

export type CustomerTask = {
  id: string;
  title: string;
  description: string;
  status: "open" | "completed" | "cancelled";
  createdAt: string;
  completedAt: string | null;
};

/** Visa outcome recorded by staff. The competent authority makes the decision. */
export type VisaOutcomeInfo = {
  outcome: VisaOutcome;
  /** Refusal reason (refused) or a note to the customer (approved). */
  note: string | null;
  at: string;
  /** Screenshot of the outcome (PDF, JPEG or PNG). */
  file: { id: string; mimeType: string } | null;
};

/** Appointment city. Lists are sorted Turkish alphabetically by name everywhere. */
export type City = { id: string; name: string; isActive: boolean; surchargeAmount: number; surchargeCurrency: Currency; sortOrder: number };

export type PaymentInfo = {
  accountHolder: string | null;
  bankName: string | null;
  iban: string | null;
  instructions: string | null;
  receiptUploadEnabled: boolean;
  /** Have the account holder and IBAN been entered? */
  configured: boolean;
};

export type CompanyContact = { email: string | null; phone: string | null };
