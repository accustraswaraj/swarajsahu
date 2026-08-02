---
title: "The Ultimate Guide to Social Share Count Caching"
date: "December 10, 2025"
excerpt: "How we engineered Novashare to fetch and aggregate social share counts without slowing down page load speeds."
category: "WordPress"
---

## Why Share Counts Are Tricky

Displaying live social share counts sounds simple, but it introduces real performance challenges:

- **External API calls** on every page load add latency.
- **Rate limits** from platforms like Twitter/X can silently fail.
- **CORS restrictions** prevent client-side fetching on most platforms.

## Our Caching Architecture

Novashare solves this with a three-tier caching strategy:

### Tier 1: Transient Cache

WordPress transients store share counts per URL with a configurable TTL (default: 24 hours). This means each URL only triggers an API call once per day, not on every page view.

```php
function novashare_get_counts(string $url): array {
    $cache_key = 'novashare_' . md5($url);
    $cached    = get_transient($cache_key);

    if ($cached !== false) {
        return $cached;
    }

    $counts = novashare_fetch_all_networks($url);
    set_transient($cache_key, $counts, DAY_IN_SECONDS);

    return $counts;
}
```

### Tier 2: Background Refresh via WP-Cron

Rather than blocking the user's request, counts are refreshed in the background using a WP-Cron event triggered when a cached value is within 1 hour of expiry. The user always sees the last known count instantly.

### Tier 3: Database Persistence

For high-traffic sites, transients may be evicted from object cache (e.g., Redis) under memory pressure. We persist counts to a custom database table as a fallback, ensuring counts survive cache flushes.

## Aggregating Multiple Networks

We fetch from multiple endpoints concurrently using non-blocking HTTP requests:

```php
$requests = [
    'facebook'  => novashare_build_fb_request($url),
    'pinterest' => novashare_build_pinterest_request($url),
];

$responses = Requests::request_multiple($requests);
```

This keeps total fetch time under 200ms regardless of how many networks you track.

## Impact on Page Load

With caching enabled, Novashare adds **zero milliseconds** to Time to First Byte (TTFB). Share counts are served directly from memory, making social proof completely free from a performance perspective.

## Conclusion

Good caching design turns a potentially expensive feature into a non-issue. By combining transients, background refresh, and database persistence, we ensure share counts are always fast and always accurate.
