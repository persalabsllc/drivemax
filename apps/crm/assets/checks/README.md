# Check MICR asset

`micr.ttf` is the unmodified Digital Graphic Labs MICR Encoding TrueType font
(original archive filename `micrenc.ttf`, copyright 1998 DGL). The complete
original freeware terms are retained in `!license.txt`. This internal application
does not sell the font. Source archive:
https://www.1001fonts.com/download/micr-encoding.zip

The font uses 4096 units per em and a 2048-unit advance. At 18 PDF points the
pitch is exactly 9 points / eight characters per inch. `A` is transit, `C` is
on-us, `B` is amount, and `D` is dash. The renderer embeds a subset so no local
font installation is needed. It keeps the amount field blank and places the
serial, routing and account in separate MICR fields. Layout references:
https://www.morovia.com/manuals/micr4/ch03.php
https://www.micrfonts.com/pdf/MICR.pdf

The font is not a certification of the printer, toner or bank acceptance.
Physical printing must preserve Actual size and use appropriate MICR toner.
The bank-number band does not move with payee/memo alignment controls.

For the bottom-of-sheet stock, the MICR baseline is 20.25pt (9/32 inch)
above the physical bottom edge. With this font at 18pt, visible glyph ink
ends below 28.66pt, keeping all characters inside the 13.5–31.5pt MICR print
strip while clearing a 1/4-inch printer margin by 2.25pt. The former 13.5pt
baseline could clip the bottoms of digits on printers with that margin.
Do not move the line to match the security background's colored border.
Placement and bottom-of-sheet margin reference: TROY MICR Basics Handbook,
sections 1-5 and 3-1:
https://8648589.fs1.hubspotusercontent-na1.net/hubfs/8648589/What-Is-MICR/currentMICRBasicsHandbook.pdf

Banking is read only on the server from `DMCRM_CHECK_BANK`, bound to the exact
organization/account UUID and masked account suffix. It is not stored in source,
general account responses or audit details. Production release checks render a
VOID PDF in memory and never create a payment or reserve its number.
