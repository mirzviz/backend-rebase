# backend-rebase

Backend Rebase course assignments. Each exercise lives in its own numbered folder, matching the numbering on [course.ronklein.co.il](https://course.ronklein.co.il/).

## Exercises

- [01 - Large Scale Dedup](01-large-scale-dedup/) — dedup a huge line-oriented file under a tight RAM budget using hash-bucket partitioning.
- [02 - Hash-Map](02-hash-map/) — a hash-map class with an injectable hash function, upsert/get/remove, and a bounded size limit.
- [03 - Large Scale Primality Test](03-large-scale-primality-test/) — count primes across a huge file of integers using a pull-based worker pool over all CPU cores.
- [04 - HTTP Blob Server](04-http-blob-server/) — a NestJS HTTP server for storing/retrieving/deleting binary blobs and headers on the filesystem, built test-first (Level 1).
- [05 - HTTP Proxy](05-http-proxy/) — a generic HTTP forward proxy supporting GET requests, forwarding headers with the required exclusions (Level 1).
- [06 - Load Balancer](06-load-balancer/) — routes blob requests to registered backend nodes via deterministic id-based hashing, with a time-boxed node registration window.
