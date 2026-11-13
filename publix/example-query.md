Use the complete savings response, not the WeeklyAd-only response. Its `Tpr`
(temporary price reduction) records are product-level sale records with a
`baseProductId`, `finalPrice`, and `originalDeal`; these are the primary source
for searchable products and prices. `WeeklyAd` and `Stacked` records remain
useful campaign context but are not product-price records.

```sh
curl 'https://services.publix.com/api/v4/savings?smImg=235&enImg=368&fallbackImg=false&isMobile=false&page=1&pageSize=0&includePersonalizedDeals=false&languageID=1&isWeb=true' \
  -H 'Accept: application/json' \
  -H 'PublixStore: 719'
```

Filter to `savingType: "Tpr"` with a positive `finalPrice`. Save the full
response as promotion context and a separate `products` array for product-first
search and grocery-list matching.
