# Lender reserve and fees

Desking → Payment options → **Lender details** opens the internal financing window. It edits the selected payment row's customer APR and term together with that row's lender name, buy APR, payout percentage, confirmed reserve override and lender fees. Apply the window, then save the desking version to retain the terms.

The automatic reserve estimate uses the difference between the rounded customer and buy-rate monthly payments, multiplied by months and the dealer payout percentage. Both payments use the same amount financed and first-payment timing as the quote. The default payout is 100% of that difference; staff can change it to the lender's agreement. Integer payment cents and payout basis points keep browser and database rounding consistent. Equal/lower customer APR produces zero estimated reserve. A confirmed reserve amount, including $0 or a flat payment, overrides the estimate. Cash deals carry neither reserve nor lender fees.

This is an estimate, not a universal lender settlement formula. Confirm against the lender's funding statement. Lender fees are dealership expenses: they reduce front gross and front commission basis, and never increase customer tax, balance or payment. Reserve increases back gross and its commission basis. Customer printouts, emails and F&I menus exclude all lender terms and internal amounts.

Migration 038 validates saved terms and calculates reserve on the server. A BEFORE INSERT sale trigger copies the selected lender, buy APR, reserve, fee and estimate/confirmed status into accounting before default commissions are created. Accounting corrections supersede those original estimates and retain the previous values in audit history. Existing quotes, sales and commissions are not backfilled or recalculated.

Verification covers quote persistence, selected-row isolation, reserve/fee math, SQL/browser cent parity, cash and zero-rate cases, customer output privacy, roles, commission basis and audited accounting corrections. `verify-lender-finance.mjs` runs rollback-only fixtures during production migrations.
