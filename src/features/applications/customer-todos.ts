import { needsCustomerAction, type DocumentSlotState } from "@/features/documents/rules";
import type { AppointmentStatus, PaymentStatus } from "@/lib/domain/constants";

/**
 * The "Yapmanız gerekenler" (what you need to do) list on the application status page. Order: payment, documents, form,
 * appointment preference, tasks given by the consultant. Texts live in the UI; this only decides which item shows when.
 */
export type CustomerTodo =
  | { kind: "payment" }
  | { kind: "document"; slotId: string; label: string; reason: "needs_correction" | "missing" | "awaiting_upload"; note: string | null }
  | { kind: "form" }
  | { kind: "appointment" }
  | { kind: "task"; id: string; title: string; description: string };

export type CustomerTodoInput = {
  paymentStatus: PaymentStatus;
  formLocked: boolean;
  appointmentStatus: AppointmentStatus;
  slots: readonly { id: string; label: string; reviewNote: string | null; state: DocumentSlotState }[];
  tasks: readonly { id: string; title: string; description: string; status: "open" | "completed" | "cancelled" }[];
};

/** If payment is pending or the reported payment could not be verified, a payment (again) is expected from the customer. */
export function isPaymentDue(paymentStatus: PaymentStatus): boolean {
  return paymentStatus === "awaiting_payment" || paymentStatus === "rejected";
}

export function buildCustomerTodos(input: CustomerTodoInput): CustomerTodo[] {
  const todos: CustomerTodo[] = [];
  if (isPaymentDue(input.paymentStatus)) todos.push({ kind: "payment" });
  for (const slot of input.slots) {
    if (!needsCustomerAction(slot.state)) continue;
    const reason = slot.state.reviewStatus === "needs_correction" ? "needs_correction" : slot.state.reviewStatus === "missing" ? "missing" : "awaiting_upload";
    // The consultant's note only matters for a correction or missing-document request (same rule as on the Documents page).
    const note = reason === "awaiting_upload" ? null : slot.reviewNote?.trim() || null;
    todos.push({ kind: "document", slotId: slot.id, label: slot.label, reason, note });
  }
  if (!input.formLocked) todos.push({ kind: "form" });
  if (input.appointmentStatus === "preferences_requested") todos.push({ kind: "appointment" });
  for (const task of input.tasks) {
    if (task.status === "open") todos.push({ kind: "task", id: task.id, title: task.title, description: task.description });
  }
  return todos;
}
