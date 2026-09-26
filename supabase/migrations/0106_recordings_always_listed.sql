-- Every recording on the website is listed there
-- Migration 0106
--
-- The recording page no longer has "List it on your website": a recording
-- shown on the website is always in its Past services list, and "Show it on
-- your website" is the one switch. Recordings saved as unlisted before that
-- change had no way back onto the list, so they are listed here.
--
-- Safe to run more than once.

update public.stream_recordings
   set visibility = 'public'
 where visibility = 'unlisted';
