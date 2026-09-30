"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import Image from "next/image";
import { ArrowRight, BookOpen, Check, ClipboardCheck, FileText, Heart, House, Megaphone, Radio, Sparkles, Users } from "lucide-react";

const tabs = [
  { id: "home", label: "Home", icon: House },
  { id: "sermons", label: "Sermons", icon: BookOpen },
  { id: "announcements", label: "Announcements", icon: Megaphone },
  { id: "live", label: "Go live", icon: Radio },
  { id: "attendance", label: "Attendance", icon: ClipboardCheck },
  { id: "people", label: "People", icon: Users },
  { id: "giving", label: "Giving", icon: Heart },
] as const;
type Tab = (typeof tabs)[number]["id"];
type Passage = "john" | "micah" | "matthew";
type Theme = "hope" | "rest" | "service";
type Channel = "App" | "Monday email" | "Facebook";
type LiveChannel = "Church website" | "Church app" | "YouTube" | "Facebook";
type FollowUp = "Text" | "Email";
type GivingPeriod = "This month" | "Last month";
type Completion = { kind: Exclude<Tab, "home">; minutes: number; detail: string };
const sampleWeekMinutes = 12 * 60 + 30;

const passages: Record<Passage, { reference: string; verse: string; idea: string; practice: string }> = {
  john: { reference: "John 15:5", verse: "Abide in me, and I in you.", idea: "Abide before you produce", practice: "Make room to remain connected to Christ" },
  micah: { reference: "Micah 6:8", verse: "Do justly, love mercy, and walk humbly with your God.", idea: "Walk humbly and act justly", practice: "Turn conviction into a small act of mercy" },
  matthew: { reference: "Matthew 11:28", verse: "Come unto me, all ye that labour and are heavy laden.", idea: "Come to Jesus with your burdens", practice: "Release what you were never asked to carry" },
};
const themes: Record<Theme, { label: string; title: string; turn: string }> = {
  hope: { label: "Hope", title: "A hope that holds", turn: "Name the hope this passage offers" },
  rest: { label: "Rest", title: "Rest for the real week", turn: "Trade hurry for trust in ordinary life" },
  service: { label: "Service", title: "Faith that moves", turn: "Let this truth shape how we serve others" },
};
const announcementChannels: Channel[] = ["App", "Monday email", "Facebook"];
const liveChannels: LiveChannel[] = ["Church website", "Church app", "YouTube", "Facebook"];

function Pill({ children }: { children: ReactNode }) {
  return <span className="marketing-demo-pill">{children}</span>;
}

export function DashboardPreview() {
  const [active, setActive] = useState<Tab>("home");
  const [discovered, setDiscovered] = useState(false);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [passage, setPassage] = useState<Passage>("john");
  const [theme, setTheme] = useState<Theme>("hope");
  const [outlineReady, setOutlineReady] = useState(false);
  const [slidesReady, setSlidesReady] = useState(false);
  const [lessonReady, setLessonReady] = useState(false);
  const [graphicReady, setGraphicReady] = useState(false);
  const [graphicGenerating, setGraphicGenerating] = useState(false);
  const [selectedChannels, setSelectedChannels] = useState<Channel[]>(announcementChannels);
  const [selectedLiveChannels, setSelectedLiveChannels] = useState<LiveChannel[]>(liveChannels);
  const [livePreview, setLivePreview] = useState(false);
  const [attendanceDraftReady, setAttendanceDraftReady] = useState(false);
  const [attendanceSent, setAttendanceSent] = useState(false);
  const [attendanceMessage, setAttendanceMessage] = useState("Hi Jordan, we missed you on Sunday. Just checking in to see how you're doing. We're here if you need anything.");
  const [followUp, setFollowUp] = useState<FollowUp>("Text");
  const [followUpDraftReady, setFollowUpDraftReady] = useState(false);
  const [followUpSent, setFollowUpSent] = useState(false);
  const [followUpMessage, setFollowUpMessage] = useState("Hi Avery, it was great meeting you on Sunday. Thanks for joining us! If you have any questions, we'd love to help.");
  const [givingPeriod, setGivingPeriod] = useState<GivingPeriod>("This month");
  const [givingReady, setGivingReady] = useState(false);
  const [completion, setCompletion] = useState<Completion | null>(null);
  const [minutesSavedHere, setMinutesSavedHere] = useState(0);
  const completionButton = useRef<HTMLButtonElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!graphicGenerating) return;
    const timer = window.setTimeout(() => { setGraphicGenerating(false); setGraphicReady(true); }, 1300);
    return () => window.clearTimeout(timer);
  }, [graphicGenerating]);

  useEffect(() => { if (completion) completionButton.current?.focus(); }, [completion]);

  useEffect(() => {
    if ((active === "attendance" && attendanceDraftReady) || (active === "people" && followUpDraftReady)) {
      contentRef.current?.scrollTo({ top: contentRef.current.scrollHeight, behavior: "auto" });
    }
  }, [active, attendanceDraftReady, followUpDraftReady]);

  function openTab(tab: Tab) {
    setActive(tab);
    setDiscovered(true);
  }

  function celebrate(result: Completion) {
    setMinutesSavedHere((previous) => previous + result.minutes);
    setCompletion(result);
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index;
    if (event.key === "ArrowDown") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowUp") next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault();
    openTab(tabs[next].id);
    tabRefs.current[next]?.focus();
  }

  function toggleChannel(channel: Channel) {
    setSelectedChannels((previous) => previous.includes(channel) ? previous.filter((item) => item !== channel) : [...previous, channel]);
  }
  function toggleLiveChannel(channel: LiveChannel) {
    setSelectedLiveChannels((previous) => previous.includes(channel) ? previous.filter((item) => item !== channel) : [...previous, channel]);
    setLivePreview(false);
  }

  const selectedPassage = passages[passage];
  const selectedTheme = themes[theme];
  const totalMinutesSaved = sampleWeekMinutes + minutesSavedHere;
  const totalHours = Math.floor(totalMinutesSaved / 60);
  const remainingMinutes = totalMinutesSaved % 60;

  return (
    <div className="marketing-dashboard-frame" aria-label="FaithForm pastor dashboard sample">
      <div className="marketing-dashboard-top"><span className="marketing-dashboard-dots" aria-hidden="true"><i /><i /><i /></span><span>FaithForm / Pastor dashboard</span><span className="marketing-dashboard-top-mark">faithform.io</span></div>
      {completion ? <div className="marketing-demo-success" role="dialog" aria-label={`Congrats, you saved ${completion.minutes} minutes`}>
        <div className="marketing-demo-success-spark marketing-demo-success-spark-one" aria-hidden="true">✦</div><div className="marketing-demo-success-spark marketing-demo-success-spark-two" aria-hidden="true">✧</div>
        <div className="marketing-demo-success-mark"><Sparkles size={26} aria-hidden="true" /></div>
        <span className="marketing-dashboard-kicker">A LITTLE TIME BACK</span>
        <h2>Congrats, you saved<br /><strong>{completion.minutes} minutes.</strong></h2>
        <p>{completion.detail}</p>
        {completion.kind === "announcements" ? <div className="marketing-demo-success-picture"><Image src="/marketing-mens-prayer-breakfast.png" width={1054} height={541} alt="Men’s Prayer Breakfast announcement picture" /></div> : <div className="marketing-demo-success-result"><Check size={18} aria-hidden="true" /><span>{completion.kind === "sermons" ? `${selectedTheme.title} · ${selectedPassage.reference} · Presentation ready` : completion.kind === "giving" ? `${givingPeriod} · Fund summary finished` : completion.kind === "people" ? `${followUp} sent to Avery in this sample` : completion.kind === "attendance" ? "Check-in text sent to Jordan in this sample" : `${selectedLiveChannels.length} destinations ready for your service`}</span></div>}
        <div className="marketing-demo-success-actions"><button ref={completionButton} type="button" onClick={() => setCompletion(null)}>See your result <ArrowRight size={14} aria-hidden="true" /></button><button type="button" onClick={() => { setCompletion(null); setActive("home"); }}>See time on Home</button></div>
        <small>Illustrative time saved in this sample workspace.</small>
      </div> : <div className="marketing-dashboard-body">
        <div className="marketing-dashboard-rail" role="tablist" aria-label="Explore dashboard tools" aria-orientation="vertical">
          <Image src="/faithform-logo.png" width={31} height={31} alt="" />
          {tabs.map(({ id, label, icon: Icon }, index) => (
            <button key={id} ref={(element) => { tabRefs.current[index] = element; }} id={`marketing-demo-tab-${id}`} type="button" role="tab" aria-label={label} aria-selected={active === id} aria-controls={`marketing-demo-panel-${id}`} tabIndex={active === id ? 0 : -1} className={active === id ? "is-current" : ""} onClick={() => openTab(id)} onKeyDown={(event) => handleTabKeyDown(event, index)}>
              <Icon size={18} strokeWidth={1.8} aria-hidden="true" /><span>{label}</span>
            </button>
          ))}
        </div>
        <div className="marketing-dashboard-content" ref={contentRef}>
          <section id="marketing-demo-panel-home" role="tabpanel" aria-labelledby="marketing-demo-tab-home" hidden={active !== "home"} tabIndex={0}>
            <div className="marketing-dashboard-kicker">YOUR WEEK, SIMPLIFIED</div>
            <div className="marketing-dashboard-content-head"><h2>Good morning, Pastor.</h2><Pill>Overview</Pill></div>
            <p className="marketing-demo-intro">One place for the work that keeps your church moving.</p>
            <div className="marketing-dashboard-context"><div className="marketing-dashboard-context-copy"><strong>Hours saved</strong><p>Illustrative weekly total</p><p className="marketing-dashboard-context-added">{minutesSavedHere > 0 ? `+${minutesSavedHere} min from the tools you tried` : "Try a tool to add time back"}</p></div><div className="marketing-dashboard-context-value" aria-live="polite" aria-label={`${totalHours} hours and ${remainingMinutes} minutes saved`}><b>{totalHours}</b><span>h</span><b>{remainingMinutes.toString().padStart(2, "0")}</b><span>m</span></div></div>
            <h3 className="marketing-dashboard-section-title">Your weekly tools</h3>
            <div className="marketing-demo-home-actions">
              <button type="button" onClick={() => openTab("sermons")}><BookOpen size={19} aria-hidden="true" /><span><strong>Build a sermon</strong><small>Passage to presentation</small></span><ArrowRight size={15} aria-hidden="true" /></button>
              <button type="button" onClick={() => openTab("announcements")}><Megaphone size={19} aria-hidden="true" /><span><strong>Make an announcement</strong><small>Graphic to channels</small></span><ArrowRight size={15} aria-hidden="true" /></button>
              <button type="button" onClick={() => openTab("people")}><Users size={19} aria-hidden="true" /><span><strong>Care for your people</strong><small>Visits to follow-up</small></span><ArrowRight size={15} aria-hidden="true" /></button>
            </div>
          </section>

          <section id="marketing-demo-panel-sermons" role="tabpanel" aria-labelledby="marketing-demo-tab-sermons" hidden={active !== "sermons"} tabIndex={0}>
            <div className="marketing-dashboard-kicker">SERMON BUILDER</div>
            <div className="marketing-dashboard-content-head"><h2>From passage to plan.</h2><Pill>Draft</Pill></div>
            <p className="marketing-demo-intro">Choose a passage and focus. Build a black-background PowerPoint from its verses, then create a small-group lesson PDF.</p>
            <div className="marketing-demo-field-row">
              <label>Passage<select value={passage} onChange={(event) => { setPassage(event.target.value as Passage); setOutlineReady(false); setSlidesReady(false); setLessonReady(false); }}><option value="john">John 15:5</option><option value="micah">Micah 6:8</option><option value="matthew">Matthew 11:28</option></select></label>
              <label>Focus<select value={theme} onChange={(event) => { setTheme(event.target.value as Theme); setOutlineReady(false); setSlidesReady(false); setLessonReady(false); }}><option value="hope">Hope</option><option value="rest">Rest</option><option value="service">Service</option></select></label>
            </div>
            <button className="marketing-demo-primary" type="button" onClick={() => { setOutlineReady(true); setSlidesReady(false); setLessonReady(false); }}><Sparkles size={15} aria-hidden="true" /> Generate sermon <ArrowRight size={15} aria-hidden="true" /></button>
            <div className="marketing-demo-output" aria-live="polite">
              {slidesReady ? <><div className="marketing-demo-slide"><span>POWERPOINT / VERSE SLIDE</span><div><small>{selectedPassage.reference}</small><strong>{selectedTheme.title}</strong><p>“{selectedPassage.verse}”</p></div><span className="marketing-demo-slide-count">01 / 04</span></div>{lessonReady && <div className="marketing-demo-lesson"><FileText size={19} aria-hidden="true" /><span><small>SMALL GROUP LESSON</small><strong>{selectedTheme.title}</strong><em>{selectedPassage.reference} · PDF ready to share</em></span><b>PDF</b></div>}</> : outlineReady ? <><div className="marketing-demo-output-top"><span>OUTLINE / {selectedPassage.reference}</span><Check size={15} aria-hidden="true" /></div><strong>{selectedTheme.title}</strong><ol><li>{selectedPassage.idea}.</li><li>{selectedTheme.turn}.</li><li>{selectedPassage.practice}.</li></ol></> : <div className="marketing-demo-empty"><BookOpen size={24} aria-hidden="true" /><span>Your three-point starter outline appears here.</span></div>}
            </div>
            {outlineReady && !slidesReady && <button className="marketing-demo-primary marketing-demo-next" type="button" onClick={() => setSlidesReady(true)}>Build PowerPoint <ArrowRight size={15} aria-hidden="true" /></button>}
            {slidesReady && <button className="marketing-demo-primary marketing-demo-next" type="button" disabled={lessonReady} onClick={() => setLessonReady(true)}><FileText size={15} aria-hidden="true" /> {lessonReady ? "Lesson PDF created" : "Create Lesson"} {!lessonReady && <ArrowRight size={15} aria-hidden="true" />}</button>}
          </section>

          <section id="marketing-demo-panel-announcements" role="tabpanel" aria-labelledby="marketing-demo-tab-announcements" hidden={active !== "announcements"} tabIndex={0}>
            <div className="marketing-dashboard-kicker">ANNOUNCEMENTS</div>
            <div className="marketing-dashboard-content-head"><h2>Say it once.</h2><Pill>Create + share</Pill></div>
            <p className="marketing-demo-intro">Make a picture for a church update, then choose where it belongs.</p>
            <div className="marketing-demo-full-field">Announcement<div className="marketing-demo-announcement-name">Men’s Prayer Breakfast</div></div>
            <button className="marketing-demo-primary" type="button" disabled={graphicGenerating} onClick={() => { setGraphicReady(false); setGraphicGenerating(true); }}><Sparkles size={15} aria-hidden="true" /> {graphicGenerating ? "Making your picture…" : "Generate Picture"} {!graphicGenerating && <ArrowRight size={15} aria-hidden="true" />}</button>
            <div className="marketing-demo-announcement-result">
              <div className="marketing-demo-poster-wrap">{graphicReady ? <Image src="/marketing-mens-prayer-breakfast.png" width={1054} height={541} alt="Men’s Prayer Breakfast announcement picture" /> : <div className={`marketing-demo-poster-empty${graphicGenerating ? " is-generating" : ""}`}>{graphicGenerating ? <><span className="marketing-demo-loading-orbit" aria-hidden="true"><Sparkles size={19} /></span><span>Putting the picture together…</span></> : <><Megaphone size={22} aria-hidden="true" /><span>Your picture<br />appears here</span></>}</div>}</div>
              <div className="marketing-demo-channel-side"><span className="marketing-demo-small-label">WHERE IT GOES</span>{announcementChannels.map((channel) => <label className="marketing-demo-check" key={channel}><input type="checkbox" checked={selectedChannels.includes(channel)} onChange={() => toggleChannel(channel)} /><span>{channel}</span></label>)}<button className="marketing-demo-secondary" type="button" disabled={!graphicReady || selectedChannels.length === 0} onClick={() => celebrate({ kind: "announcements", minutes: 30, detail: `Your sample announcement is submitted for ${selectedChannels.join(", ")}. Nothing was posted outside this preview.` })}>Submit announcement <ArrowRight size={13} aria-hidden="true" /></button></div>
            </div>
            <p className="marketing-demo-feedback" role="status">{graphicGenerating ? "A little creative magic is happening…" : graphicReady ? "Picture ready. Choose its channels, then submit the sample announcement." : "Select Generate Picture to see the announcement come to life."}</p>
          </section>

          <section id="marketing-demo-panel-live" role="tabpanel" aria-labelledby="marketing-demo-tab-live" hidden={active !== "live"} tabIndex={0}>
            <div className="marketing-dashboard-kicker">LIVE STREAMING</div>
            <div className="marketing-dashboard-content-head"><h2>One stream. Everywhere.</h2><Pill>Go live</Pill></div>
            <p className="marketing-demo-intro">Pick where a service should appear. The real dashboard connects your destinations first.</p>
            <div className="marketing-demo-live-map"><div className="marketing-demo-live-source"><Radio size={21} aria-hidden="true" /><strong>Sunday service</strong><span>ONE SOURCE</span></div><div className="marketing-demo-live-line" aria-hidden="true" /><div className="marketing-demo-live-destinations">{liveChannels.map((channel) => <label key={channel} className={selectedLiveChannels.includes(channel) ? "is-selected" : ""}><input type="checkbox" checked={selectedLiveChannels.includes(channel)} onChange={() => toggleLiveChannel(channel)} /><span>{channel}</span><Check size={13} aria-hidden="true" /></label>)}</div></div>
            <button className="marketing-demo-primary" type="button" disabled={selectedLiveChannels.length === 0} onClick={() => setLivePreview(true)}>Preview live setup <ArrowRight size={15} aria-hidden="true" /></button>
            {livePreview ? <div className="marketing-demo-review-card"><Check size={17} aria-hidden="true" /><span>One service is ready for {selectedLiveChannels.join(", ")}.</span></div> : <p className="marketing-demo-feedback">Choose your destinations to see the setup.</p>}
            {livePreview && <button className="marketing-demo-primary marketing-demo-next" type="button" onClick={() => celebrate({ kind: "live", minutes: 20, detail: `Your sample service is set for ${selectedLiveChannels.length} ${selectedLiveChannels.length === 1 ? "place" : "places"}. No stream started.` })}>Finish setup <ArrowRight size={15} aria-hidden="true" /></button>}
          </section>

          <section id="marketing-demo-panel-attendance" role="tabpanel" aria-labelledby="marketing-demo-tab-attendance" hidden={active !== "attendance"} tabIndex={0}>
            <div className="marketing-dashboard-kicker">ATTENDANCE + FOLLOW-UP</div>
            <div className="marketing-dashboard-content-head"><h2>Notice who&apos;s missing.</h2><Pill>Sunday</Pill></div>
            <p className="marketing-demo-intro">See the gap in the roll, then let a caring note do the follow-up.</p>
            <div className="marketing-demo-attendance-card"><div><span className="marketing-demo-small-label">THIS SERVICE</span><strong>84<small> present</small></strong></div><span className="marketing-demo-attendance-avatars" aria-hidden="true"><i>M</i><i>A</i><i>S</i></span></div>
            <div className="marketing-demo-person marketing-demo-person-feature"><span className="marketing-demo-person-avatar">J</span><span><strong>Jordan Lee</strong><small>Not seen in two weeks</small></span><span className="marketing-demo-new-label">CHECK IN</span></div>
            <button className="marketing-demo-primary" type="button" onClick={() => { setAttendanceDraftReady(true); setAttendanceSent(false); }}>Prepare check-in text <ArrowRight size={15} aria-hidden="true" /></button>
            {attendanceDraftReady ? <div className="marketing-demo-message"><span className="marketing-demo-small-label">READY TO SEND / JORDAN</span><textarea aria-label="Check-in text for Jordan" value={attendanceMessage} maxLength={240} onChange={(event) => setAttendanceMessage(event.target.value)} /><button type="button" disabled={!attendanceMessage.trim() || attendanceSent} onClick={() => { setAttendanceSent(true); celebrate({ kind: "attendance", minutes: 10, detail: "Jordan's check-in text was sent in this sample. No real message left this page." }); }}>{attendanceSent ? "Sample text sent" : "Send sample text"} <ArrowRight size={13} aria-hidden="true" /></button></div> : <div className="marketing-demo-followup"><ClipboardCheck size={17} aria-hidden="true" /><span>FaithForm has a check-in note ready when someone hasn&apos;t been back.</span></div>}
          </section>

          <section id="marketing-demo-panel-people" role="tabpanel" aria-labelledby="marketing-demo-tab-people" hidden={active !== "people"} tabIndex={0}>
            <div className="marketing-dashboard-kicker">PEOPLE + FOLLOW-UP</div>
            <div className="marketing-dashboard-content-head"><h2>Remember the person.</h2><Pill>Care</Pill></div>
            <p className="marketing-demo-intro">Turn a first visit into a warm welcome they actually receive.</p>
            <div className="marketing-demo-person marketing-demo-person-feature"><span className="marketing-demo-person-avatar">A</span><span><strong>Avery Brooks</strong><small>First visit · Sunday service</small></span><span className="marketing-demo-new-label">NEW</span></div>
            <div className="marketing-demo-field-row"><label>Welcome by<select value={followUp} onChange={(event) => { setFollowUp(event.target.value as FollowUp); setFollowUpDraftReady(false); setFollowUpSent(false); }}><option>Text</option><option>Email</option></select></label><div className="marketing-demo-due"><span>WHEN</span><strong>Today</strong></div></div>
            <button className="marketing-demo-primary" type="button" onClick={() => { setFollowUpDraftReady(true); setFollowUpSent(false); }}>Draft welcome <ArrowRight size={15} aria-hidden="true" /></button>
            {followUpDraftReady ? <div className="marketing-demo-message"><span className="marketing-demo-small-label">READY TO SEND / AVERY</span><textarea aria-label="Welcome message for Avery" value={followUpMessage} maxLength={240} onChange={(event) => setFollowUpMessage(event.target.value)} /><button type="button" disabled={!followUpMessage.trim() || followUpSent} onClick={() => { setFollowUpSent(true); celebrate({ kind: "people", minutes: 15, detail: `Avery's welcome ${followUp.toLowerCase()} was sent in this sample. No real message left this page.` }); }}>{followUpSent ? "Sample welcome sent" : `Send sample ${followUp.toLowerCase()}`} <ArrowRight size={13} aria-hidden="true" /></button></div> : <div className="marketing-demo-care-path"><span><Check size={13} aria-hidden="true" /> First visit recorded</span><span>Welcome message waiting to be drafted</span></div>}
          </section>

          <section id="marketing-demo-panel-giving" role="tabpanel" aria-labelledby="marketing-demo-tab-giving" hidden={active !== "giving"} tabIndex={0}>
            <div className="marketing-dashboard-kicker">GIVING</div>
            <div className="marketing-dashboard-content-head"><h2>See the whole picture.</h2><Pill>Reports</Pill></div>
            <p className="marketing-demo-intro">A clear fund summary without another spreadsheet afternoon.</p>
            <div className="marketing-demo-field-row marketing-demo-giving-controls"><label>Period<select value={givingPeriod} onChange={(event) => { setGivingPeriod(event.target.value as GivingPeriod); setGivingReady(false); }}><option>This month</option><option>Last month</option></select></label><button className="marketing-demo-primary" type="button" onClick={() => setGivingReady(true)}>Build report <ArrowRight size={15} aria-hidden="true" /></button></div>
            <div className="marketing-demo-giving-card" aria-live="polite">
              {givingReady ? <><span className="marketing-demo-small-label">ILLUSTRATIVE FUND SUMMARY</span><strong>{givingPeriod === "This month" ? "$11,020" : "$9,950"} <small>total</small></strong><div className="marketing-demo-giving-bars"><span><i style={{ width: "100%" }} /><b>General</b></span><span><i style={{ width: "45%" }} /><b>Missions</b></span><span><i style={{ width: "24%" }} /><b>Care</b></span></div></> : <div className="marketing-demo-empty"><Heart size={23} aria-hidden="true" /><span>Your sample giving summary appears here.</span></div>}
            </div>
            {givingReady && <button className="marketing-demo-primary marketing-demo-next" type="button" onClick={() => celebrate({ kind: "giving", minutes: 20, detail: "Your sample giving summary is finished and ready to review with your team." })}>Finish report <ArrowRight size={15} aria-hidden="true" /></button>}
          </section>
        </div>
      </div>}
      <div className="marketing-dashboard-caption" aria-live="polite"><span>{completion ? "✦ Time back for what matters." : discovered ? "✦ Nice find. Keep exploring." : "More time for what matters."}</span><span>{discovered ? "Sample workspace · no real changes" : "faithform.io"}</span></div>
    </div>
  );
}
