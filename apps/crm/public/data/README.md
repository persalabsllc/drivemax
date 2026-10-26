# ZIP distance reference

`zip-centroids.json` contains GEOID → [INTPTLAT, INTPTLONG], rounded to five decimal places, from the US Census Bureau 2025 National ZCTA Gazetteer.

Source: https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2025_Gazetteer/2025_Gaz_zcta_national.zip

These are representative points for statistical ZIP Code Tabulation Areas, not customer locations or driving distances. ZIPs without a matching ZCTA cannot participate in radius searches; exact ZIP matching still works. The complete data file is loaded only when the user enables radius search. No customer data is transmitted to Census or any geocoding provider.
