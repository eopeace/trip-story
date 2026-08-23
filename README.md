# Trip Story

One app, many trips. A group comes home from a trip with a thousand photos spread
across several phones; this turns that pile into one site worth showing, without
anybody sorting anything.

## Addresses
| path | what it is |
|---|---|
| `/` | what this is, and a button to start |
| `/new` | create a trip — name and dates, nothing else |
| `/<user>` | that person's trips |
| `/<user>/<trip>` | a trip: days, gallery, map, stories |
| `/u/<link>` | add photos to one trip. No account, no app. |

A trip's name only has to be unique inside its own account, so everyone can have
a `vienna`.

## How it fits together
```
upload page  ->  /api/upload-url  ->  signed link  ->  storage  t/<mediaId>/inbox/<who>/
                 (checks the link is live)                        |
                                                                  v
                                              .github/workflows/ingest.yml
                                              every 15 min, or run by hand
                                                                  |
   t/<mediaId>/images thumbs videos posters   <------------------+---->  manifest.json
   t/<mediaId>/originals/<who>/  kept untouched                          beside the photos
```

The photo list lives beside the photos, not in this repo: an upload rewrites one
small file instead of rebuilding the whole site.

The browser uploads straight to storage, which is the point — a photo that passes
through a chat app loses the date and place recorded inside it, and without those
it cannot be put on a day or on a map. When a photo arrives with nothing, the
pipeline falls back to the date in its filename (`IMG-20260814-WA0007`), then to
the day the uploader picked, and marks the time as a guess.

## Settings needed once
| where | name |
|---|---|
| Netlify → environment | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` |
| GitHub → repo secrets | the same three |
| Firebase → Auth → Authorized domains | this site's domain |
| Firebase → Firestore → Rules | publish `firestore.rules` |
| R2 bucket | a CORS rule allowing PUT from this site |

## Not built yet
- Naming faces on a new trip (a new group has nobody to compare against).
- Places proposing themselves from where the photos were taken.
- Paying for anything.
