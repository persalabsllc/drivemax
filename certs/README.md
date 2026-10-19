# Supabase database trust anchor

`supabase-root-2021.crt` is Supabase's public production root CA, downloaded over HTTPS on 2026-10-19 from:

https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt

The URL is published by Supabase's dashboard source in `apps/studio/hooks/custom-content/custom-content.json`:
https://github.com/supabase/supabase/blob/b328ca6d5a9b4ea45edd36ce80d72efe4bbdc252/apps/studio/hooks/custom-content/custom-content.json

The notification migration uses this CA only for `*.pooler.supabase.com`, with `sslmode=verify-full`. This file contains no private key or credential. Update it from Supabase's official source when the provider rotates its CA.
