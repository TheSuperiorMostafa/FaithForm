# Recording download fixtures

Synthetic test pattern and sine wave only. The normal source is 2 seconds of
160×90 H.264 at 12 fps plus mono AAC at 48 kHz, split into two 1-second fMP4
fragments. The changed source is one second at 320×180 and a different tone.
No church or other private media is included.

Generated with FFmpeg:

```sh
ffmpeg -f lavfi -i testsrc2=size=160x90:rate=12 \
  -f lavfi -i sine=frequency=440:sample_rate=48000 -t 2 \
  -c:v libx264 -preset ultrafast -pix_fmt yuv420p -g 12 -keyint_min 12 \
  -sc_threshold 0 -c:a aac -b:a 64k -f hls -hls_time 1 \
  -hls_playlist_type vod -hls_segment_type fmp4 \
  -hls_segment_filename 'seg_%02d.m4s' index.m3u8
```

The changed fixture uses `size=320x180`, `frequency=660`, and `-t 1`.
Tests construct the playlists so they can exercise encoder reconnects,
independent initialization files, missing media, and changed configurations.
