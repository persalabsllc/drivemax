-- Owner-requested next-day thank-you and Google review invitation.
-- The delivery service renders this trusted standalone URL as a branded button.
-- Existing opt-outs, pauses, enabled state and sending hours remain in force.
update public.dmcrm_email_templates
set body = $body$Hi {{first_name}},

Thank you for purchasing {{vehicle}} from Drive Max Used Cars! We appreciate your business and the opportunity to help you find your next vehicle.

We hope you're enjoying your vehicle. When you have a moment, would you please share your experience in a Google review? Your honest feedback means a lot to our team and helps other local drivers get to know Drive Max.

https://search.google.com/local/writereview?placeid=ChIJvzL6lxvRqIkRLEFsYcr3ABM

If you have any questions about your vehicle or paperwork, just reply to this email or call {{phone}}. We're always happy to help.

Thank you again, and enjoy the road ahead!$body$,
    revision = revision + 1
where org_id = 'd5a1c100-0000-4000-8000-000000000001'
  and system_key = 'sold';

update public.dmcrm_workflow_rules r
set delay_minutes = 1440,
    revision = r.revision + 1
from public.dmcrm_email_templates t
where t.id = r.template_id and t.org_id = r.org_id
  and r.org_id = 'd5a1c100-0000-4000-8000-000000000001'
  and r.event = 'sold' and r.channel = 'email' and t.system_key = 'sold';

-- Move only not-yet-queued thank-you jobs to 24 hours after their sale event.
-- Never replay or modify a previously sent, claimed, canceled or skipped email.
update public.dmcrm_workflow_jobs j
set run_at = j.anchor_at + interval '24 hours'
from public.dmcrm_workflow_rules r, public.dmcrm_email_templates t
where j.rule_id = r.id and j.org_id = r.org_id
  and r.template_id = t.id and r.org_id = t.org_id
  and j.org_id = 'd5a1c100-0000-4000-8000-000000000001'
  and j.event = 'sold' and r.channel = 'email' and t.system_key = 'sold'
  and j.state = 'scheduled' and j.message_id is null;
