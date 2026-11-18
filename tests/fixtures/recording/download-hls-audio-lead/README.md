Audio-leading fMP4 take for `tests/unit/recording-download-audio-lead.test.ts`.

Made from `../download-hls` (the 2 s H.264/AAC clip, repeated three times) by
re-fragmenting it with mediabunny's fragmented MP4 output while feeding the
audio 0.6 s ahead of the video, then splitting the file into `init.mp4` and one
`.m4s` per `moof`+`mdat`. Each fragment therefore carries audio that runs past
its video, as FaithForm's live encoder produces.
