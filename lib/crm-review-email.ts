import { GOOGLE_WRITE_REVIEW_URL } from "./reviews";

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (character) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!,
  );

const preferencesPattern =
  /^Email preferences: (https:\/\/crm\.drivemaxusedcars\.com\/email-preferences\/[0-9a-f-]{36})$/i;

/** The editable CRM body stays plain text. Only our exact review URL becomes a
 * button; customer names, vehicle descriptions and signatures are always escaped.
 * Emails without that standalone URL retain their existing plain-text format. */
export function crmReviewEmailHtml(subject: string, body: string) {
  const paragraphs = body.trim().split(/\r?\n\s*\r?\n/);
  if (!paragraphs.some((paragraph) => paragraph.trim() === GOOGLE_WRITE_REVIEW_URL))
    return undefined;

  let preferencesUrl: string | undefined;
  const content = paragraphs.map((paragraph) => {
    const text = paragraph.trim();
    const preferences = text.match(preferencesPattern);
    if (preferences) {
      preferencesUrl = preferences[1];
      return "";
    }
    if (text === GOOGLE_WRITE_REVIEW_URL) {
      return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:28px 0 30px;"><tr><td align="center">
<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${GOOGLE_WRITE_REVIEW_URL}" style="height:54px;v-text-anchor:middle;width:270px;" arcsize="15%" stroke="f" fillcolor="#ffda3e"><w:anchorlock/><center style="color:#08182d;font-family:Arial,sans-serif;font-size:17px;font-weight:bold;">Leave a Google review</center></v:roundrect><![endif]-->
<!--[if !mso]><!--><a class="review-button" href="${GOOGLE_WRITE_REVIEW_URL}" target="_blank" rel="noopener noreferrer" style="display:inline-block;background-color:#ffda3e;border:1px solid #ffda3e;border-radius:8px;color:#08182d;font-family:Arial,Helvetica,sans-serif;font-size:17px;font-weight:700;line-height:24px;padding:15px 26px;text-align:center;text-decoration:none;mso-hide:all;">Leave a Google review</a><!--<![endif]-->
</td></tr></table>`;
    }
    return `<p style="margin:0 0 20px;color:#263b52;font-size:16px;line-height:26px;overflow-wrap:break-word;">${escapeHtml(text).replace(/\r?\n/g, "<br>")}</p>`;
  }).join("\n");

  return `<!doctype html>
<html lang="en" dir="ltr" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">
<title>${escapeHtml(subject)}</title>
<style>@media only screen and (max-width:620px){.email-outer{padding:12px 8px!important}.email-body{padding:28px 24px 12px!important}.email-hero{padding:24px!important}.email-heading{font-size:30px!important;line-height:36px!important}.review-button{display:block!important}}</style>
<!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->
</head>
<body style="margin:0;padding:0;background-color:#edf2f8;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;">
<div lang="en" dir="ltr" style="display:none;max-height:0;overflow:hidden;mso-hide:all;">Thank you for choosing Drive Max. We would love to hear about your experience.</div>
<table lang="en" dir="ltr" role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="#edf2f8"><tr><td class="email-outer" align="center" style="padding:32px 12px;">
<!--[if mso]><table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;background-color:#ffffff;border:1px solid #dce3ec;border-radius:14px;overflow:hidden;">
<tr><td height="5" bgcolor="#ef2638" style="font-size:1px;line-height:5px;">&nbsp;</td></tr>
<tr><td align="center" bgcolor="#08182d" style="padding:26px 24px 8px;">
<img src="https://www.drivemaxusedcars.com/email/drive-max-logo.png" width="236" height="119" alt="Drive Max Used Cars" style="display:block;width:236px;height:auto;max-width:100%;border:0;">
</td></tr>
<tr><td class="email-hero" bgcolor="#08182d" style="padding:20px 40px 34px;text-align:center;">
<p style="margin:0 0 12px;color:#ffda3e;font-size:11px;line-height:18px;letter-spacing:2px;font-weight:700;">A LITTLE THANK YOU. A LOT OF APPRECIATION.</p>
<h1 class="email-heading" style="margin:0;color:#ffffff;font-size:36px;line-height:42px;font-weight:800;letter-spacing:-1px;">Thank you for<br>choosing Drive Max!</h1>
</td></tr>
<tr><td height="4" bgcolor="#1680e8" style="font-size:1px;line-height:4px;">&nbsp;</td></tr>
<tr><td class="email-body" bgcolor="#ffffff" style="padding:34px 40px 16px;">${content}</td></tr>
<tr><td align="center" bgcolor="#f0f7ff" style="padding:24px;border-top:1px solid #ddecff;">
<p style="margin:0 0 7px;color:#0757b8;font-size:12px;line-height:18px;letter-spacing:1px;font-weight:700;">YOUR NEXT CHAPTER STARTS HERE.</p>
<p style="margin:0;color:#52657c;font-size:13px;line-height:20px;">Drive Max Used Cars &bull; New Bern, North Carolina</p>
</td></tr></table>
<!--[if mso]></td></tr></table><![endif]-->
${preferencesUrl ? `<p style="margin:20px 12px 0;font-size:12px;line-height:20px;"><a href="${escapeHtml(preferencesUrl)}" style="color:#52657c;text-decoration:underline;">Manage email preferences</a></p>` : ""}
</td></tr></table></body></html>`;
}
