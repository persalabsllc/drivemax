# Sales workflow implementation

Authorized: all recommendations from the October 27 CRM audit except paid texting. Email confirmations, reschedules, reminders and missed appointment messages are explicitly requested. SMS remains inactive; no provider purchase or activation.

Baseline: production `29c994786d93afd7c528811cafaff1e8cbd98c92`, CRM project `prj_mMh5v8DCSJBufyLSALIeHzfGAjE9`, branch `crm/foundation`. Website main is a separate deployment. All application changes stay within apps/crm unless a necessary website worker change is separately tested.

## Deliverables
- Work Today queue, unanswered replies, uncontacted leads, tasks, appointments, missing next actions, stale proposals; ownership filters and quick actions.
- Configurable email/task workflows, future-only enrollment, pause/cancel controls, idempotent queue, business hours, suppression/reply/appointment/sale stops; background scheduler independent of open browser.
- Appointment confirmation/reschedule/cancellation/missed emails, day-before/two-hour reminders, secure confirm/reschedule response and calendar download.
- Sales stages and event history; source/staff funnel, human response, lost reasons, vehicle interest and F&I penetration reporting.
- Buyer requirements and inventory matching with prepared messages for staff review.
- Delivery checklist, missing-data review, signed document upload/download, archive finalized packet; no e-sign or lender connection claimed.
- Inventory preparation stages, recon line items; financing/stipulation/funding tracker.
- Optional browser/home-screen push notifications with per-user authorization. SMS disabled.

## Validation/release
- Use existing service-only SQL RPC and tenant-scoped reads. New numbered migrations only.
- Meaningful PGlite integration tests for scheduling, rescheduling, missed appointments, retries, stopping conditions, ownership and cross-tenant denial; unit tests for queue, matching and metrics.
- Typecheck, full tests, production build without shared migration locally; browser/demo and API checks. Production migration checks use rolled-back fixtures.
- Publish reviewed code to feature branch, PR to crm/foundation, deploy tested release, verify live state and scheduler health. Never send real customer test mail.

## Progress
- Existing schema, email outbox/worker, appointments and UI reviewed. Existing website email cron is daily; a frequent scheduler is needed for reminders without a browser.

- Implemented all seven feature areas, 18 enabled editable follow-up steps, six new appointment/anniversary templates, customer confirmation/reschedule-request/calendar links and unsubscribe controls.
- Tests: 107 passed with sequential PGlite workers; targeted 13 workflow tests passed after final SQL changes; TypeScript and production build passed. An initial parallel run encountered a local V8/WASM runtime crash; sequential full-suite run passed.
- Browser: demo Work Today, edit automation, save buyer requirements, save deal stage, inventory prep, mobile 390px, report PDF content verified. API signed-out checks returned 401 and cross-origin appointment mutation returned 403. Browser console had only a blocked external resource; no application exceptions.
- Release: feature branch prepared; production migration must verify the scheduler and rolled-back integration fixtures. Health endpoint checks database background and delivery-worker heartbeats separately.
