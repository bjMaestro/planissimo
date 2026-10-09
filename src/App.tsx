
import { useState, useEffect, useMemo, useRef } from "react";
import Papa from "papaparse";

const CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vS4IgUUEP_0stkksstahZ3-W20q0D55OT5HFZIkkhdquVjDkXvTOQmgJwC5JTsQntMHgGC-vltGQ_Gv/pub?output=csv";

type RehearsalRow = {
  Date: string;
  Ensemble: string;
  "Agenda Step": string;
  "Time Allotted": string;
  Objective: string;
  Notes?: string;
};

function App() {
  const [data, setData] = useState<RehearsalRow[]>([]);
  const [instances, setInstances] = useState<string[]>([]);
  const [selectedInstance, setSelectedInstance] = useState<string | null>(null);
  const [activeStepIndex, setActiveStepIndex] = useState<number | null>(null);

  // ---------- TIMER STATE ----------

  const [activeTimer, setActiveTimer] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState<number>(0);
  const [isPaused, setIsPaused] = useState(false);
  const [timerEndTime, setTimerEndTime] = useState<number | null>(null);

  const [timerComplete, setTimerComplete] = useState(false);
  const [completionPulse, setCompletionPulse] = useState(false);

  const timerIntervalRef = useRef<number | null>(null);
  const pulseTimeoutRef = useRef<number | null>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const scheduledCueNodesRef = useRef<OscillatorNode[]>([]);

  // ---------- DATE HELPERS ----------

  const parseLocalDate = (dateString: string) => {
    const [year, month, day] = dateString.split("-").map(Number);
    return new Date(year, month - 1, day);
  };

  const getStartOfWeek = (baseDate: Date) => {
    const date = new Date(baseDate);
    const day = date.getDay();
    const diff = date.getDate() - day + (day === 0 ? -6 : 1);

    return new Date(date.getFullYear(), date.getMonth(), diff);
  };

  const isThisWeek = (dateString: string) => {
    const today = new Date();

    const todayLocal = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate()
    );

    const startOfWeek = getStartOfWeek(todayLocal);
    startOfWeek.setHours(0, 0, 0, 0);

    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);

    const date = parseLocalDate(dateString);

    return date >= startOfWeek && date <= endOfWeek;
  };

  const formatDisplayDate = (dateString: string) => {
    const date = parseLocalDate(dateString);

    return date.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
  };

  // ---------- FETCH CSV ----------

  useEffect(() => {
    Papa.parse<RehearsalRow>(CSV_URL, {
      download: true,
      header: true,

      complete: (results) => {
        const rows = results.data.filter((row) => row.Date);

        setData(rows);

        const rehearsalInstances: string[] = rows.map(
          (row) => `${row.Ensemble}||${row.Date}`
        );

        const uniqueInstances = Array.from(new Set(rehearsalInstances))
          .filter((instance) => {
            const [, date] = instance.split("||");

            return isThisWeek(date);
          })
          .sort((a, b) => {
            const [ensembleA, dateA] = a.split("||");
            const [ensembleB, dateB] = b.split("||");

            const dA = parseLocalDate(dateA).getTime();
            const dB = parseLocalDate(dateB).getTime();

            if (dA !== dB) {
              return dA - dB;
            }

            return ensembleA.localeCompare(ensembleB);
          });

        setInstances(uniqueInstances);
        autoSelect(uniqueInstances);
      },
    });
  }, []);

  const autoSelect = (uniqueInstances: string[]) => {
    const today = new Date();

    const todayString = `${today.getFullYear()}-${String(
      today.getMonth() + 1
    ).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

    const todaysInstances = uniqueInstances.filter((instance) =>
      instance.endsWith(`||${todayString}`)
    );

    if (todaysInstances.length === 1) {
      setSelectedInstance(todaysInstances[0]);
    } else {
      setSelectedInstance(null);
    }
  };

  const filteredData = useMemo(() => {
    if (!selectedInstance) {
      return [];
    }

    const [ensemble, date] = selectedInstance.split("||");

    return data.filter(
      (row) => row.Date === date && row.Ensemble === ensemble
    );
  }, [data, selectedInstance]);

  const ensembleName = selectedInstance
    ? selectedInstance.split("||")[0]
    : "";

  const displayDate = selectedInstance
    ? selectedInstance.split("||")[1]
    : "";

  // ---------- TIMER AUDIO ----------

  const cancelScheduledCue = () => {
    scheduledCueNodesRef.current.forEach((oscillator) => {
      try {
        oscillator.stop();
      } catch {
        // Oscillator may already have finished.
      }
    });

    scheduledCueNodesRef.current = [];
  };

  const scheduleCompletionCue = async (delaySeconds: number) => {
    cancelScheduledCue();

    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContext();
      }

      const context = audioContextRef.current;

      if (context.state === "suspended") {
        await context.resume();
      }

      const cueStart = context.currentTime + delaySeconds;

      const notes = [
        {
          frequency: 523.25,
          startOffset: 0,
        },
        {
          frequency: 659.25,
          startOffset: 0.34,
        },
      ];

      notes.forEach(({ frequency, startOffset }) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();

        const noteStart = cueStart + startOffset;
        const noteEnd = noteStart + 0.36;

        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(frequency, noteStart);

        gain.gain.setValueAtTime(0.0001, noteStart);

        gain.gain.exponentialRampToValueAtTime(
          0.095,
          noteStart + 0.035
        );

        gain.gain.exponentialRampToValueAtTime(0.0001, noteEnd);

        oscillator.connect(gain);
        gain.connect(context.destination);

        oscillator.start(noteStart);
        oscillator.stop(noteEnd + 0.02);

        scheduledCueNodesRef.current.push(oscillator);
      });
    } catch {
      // Timer and visual completion still work if audio is blocked.
    }
  };

  // ---------- CLOCK-BASED TIMER ----------

  useEffect(() => {
    if (!activeTimer || isPaused || timerEndTime === null) {
      return;
    }

    const updateTimer = () => {
      const millisecondsLeft = timerEndTime - Date.now();

      const secondsLeft = Math.max(
        0,
        Math.ceil(millisecondsLeft / 1000)
      );

      setRemainingSeconds(secondsLeft);

      if (millisecondsLeft <= 0) {
        setRemainingSeconds(0);
        setActiveTimer(false);
        setIsPaused(false);
        setTimerEndTime(null);

        setCompletionPulse(true);
        setTimerComplete(true);

        if (pulseTimeoutRef.current !== null) {
          window.clearTimeout(pulseTimeoutRef.current);
        }

        pulseTimeoutRef.current = window.setTimeout(() => {
          setCompletionPulse(false);
        }, 2500);
      }
    };

    updateTimer();

    timerIntervalRef.current = window.setInterval(updateTimer, 250);

    const handleVisibilityChange = () => {
      if (!document.hidden) {
        updateTimer();
      }
    };

    const handleFocus = () => {
      updateTimer();
    };

    document.addEventListener(
      "visibilitychange",
      handleVisibilityChange
    );

    window.addEventListener("focus", handleFocus);

    return () => {
      if (timerIntervalRef.current !== null) {
        window.clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }

      document.removeEventListener(
        "visibilitychange",
        handleVisibilityChange
      );

      window.removeEventListener("focus", handleFocus);
    };
  }, [activeTimer, isPaused, timerEndTime]);

  const startTimer = (minutes: number) => {
    const seconds = Math.max(0, minutes * 60);

    if (seconds === 0) {
      return;
    }

    const endTime = Date.now() + seconds * 1000;

    setRemainingSeconds(seconds);
    setTimerEndTime(endTime);

    setActiveTimer(true);
    setIsPaused(false);

    setTimerComplete(false);
    setCompletionPulse(false);

    void scheduleCompletionCue(seconds);
  };

  const pauseTimer = () => {
    if (timerEndTime === null) {
      return;
    }

    const secondsLeft = Math.max(
      0,
      Math.ceil((timerEndTime - Date.now()) / 1000)
    );

    setRemainingSeconds(secondsLeft);
    setTimerEndTime(null);
    setIsPaused(true);

    cancelScheduledCue();
  };

  const resumeTimer = () => {
    if (remainingSeconds <= 0) {
      return;
    }

    const endTime = Date.now() + remainingSeconds * 1000;

    setTimerEndTime(endTime);
    setIsPaused(false);

    void scheduleCompletionCue(remainingSeconds);
  };

  const clearTimerForStepChange = () => {
    cancelScheduledCue();

    setActiveTimer(false);
    setIsPaused(false);
    setRemainingSeconds(0);
    setTimerEndTime(null);

    setTimerComplete(false);
    setCompletionPulse(false);

    if (pulseTimeoutRef.current !== null) {
      window.clearTimeout(pulseTimeoutRef.current);
      pulseTimeoutRef.current = null;
    }
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;

    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const activeStep =
    activeStepIndex !== null
      ? filteredData[activeStepIndex]
      : null;

  // ---------- RESPONSIVE UI ----------
  // Container queries react to the embedded frame width.
  // All data and timer behavior above is unchanged.

  return (
    <>
      <style>
        {`
          @keyframes planissimoTimerPulse {
            0% { background-color: #eef1f9; }
            50% { background-color: #cfd9f7; }
            100% { background-color: #eef1f9; }
          }

          .planissimo-outer {
            height: 100vh;
            height: 100dvh;
            width: 100%;
            margin: 0;
            padding: clamp(8px, 2.5cqw, 28px)
                     clamp(8px, 2.8cqw, 32px);
            box-sizing: border-box;
            overflow: hidden;
            container-type: inline-size;
            background-color: #2c3e70;
            background-image:
              radial-gradient(circle at 14% 22%,
                rgba(255,255,255,0.13) 0px,
                rgba(255,255,255,0.13) 3px,
                transparent 4px),
              radial-gradient(circle at 84% 68%,
                rgba(255,255,255,0.10) 0px,
                rgba(255,255,255,0.10) 4px,
                transparent 5px),
              repeating-linear-gradient(135deg,
                transparent 0px,
                transparent 54px,
                rgba(255,255,255,0.07) 54px,
                rgba(255,255,255,0.07) 56px,
                transparent 56px,
                transparent 108px),
              repeating-linear-gradient(45deg,
                transparent 0px,
                transparent 145px,
                rgba(255,255,255,0.045) 145px,
                rgba(255,255,255,0.045) 147px,
                transparent 147px,
                transparent 290px),
              linear-gradient(135deg,
                #22335f 0%,
                #2c3e70 50%,
                #38518a 100%);
            font-family: 'Outfit', sans-serif;
            color: #1f2233;
          }

          .planissimo-surface {
            width: 100%;
            height: 100%;
            display: flex;
            flex-direction: column;
            min-width: 0;
            padding: clamp(12px, 4cqw, 48px)
                     clamp(12px, 6cqw, 70px)
                     clamp(12px, 3.5cqw, 42px);
            box-sizing: border-box;
            overflow: hidden;
            border: 2px solid #2c3e70;
            border-radius: 16px;
            box-shadow: 0 12px 34px rgba(13,24,52,0.30);
          }

          .planissimo-header {
            flex: 0 0 auto;
            min-width: 0;
          }

          .planissimo-title {
            font-family: 'Righteous', sans-serif;
            font-size: clamp(23px, 4cqw, 46px);
            line-height: 1.12;
            color: #2c3e70;
            margin: 0 0 clamp(3px, 0.6cqw, 6px);
            letter-spacing: 1px;
          }

          .planissimo-tagline {
            color: #6b7280;
            font-size: clamp(12px, 1.45cqw, 16px);
            margin: 0 0 clamp(10px, 2.5cqw, 30px);
          }

          .planissimo-selector-wrap {
            margin-bottom: clamp(10px, 2.2cqw, 26px);
          }

          .planissimo-selector {
            display: block;
            width: 100%;
            min-width: 0;
            padding: clamp(6px, 1.1cqw, 12px);
            border: 2px solid #2c3e70;
            border-radius: 8px;
            font-size: clamp(12px, 1.45cqw, 16px);
            font-family: 'Outfit', sans-serif;
            background: white;
            color: #1f2233;
          }

          .planissimo-ensemble {
            color: #2c3e70;
            font-size: clamp(17px, 2.4cqw, 26px);
            line-height: 1.15;
            margin: 0 0 4px;
          }

          .planissimo-date {
            color: #6b7280;
            font-size: clamp(12px, 1.4cqw, 16px);
            margin-bottom: clamp(10px, 2cqw, 24px);
          }

          .planissimo-workspace {
            flex: 1 1 auto;
            min-height: 0;
            min-width: 0;
            display: grid;
            grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr);
            gap: clamp(8px, 4.3cqw, 50px);
            overflow: hidden;
          }

          .planissimo-agenda-scroll {
            min-width: 0;
            min-height: 0;
            overflow-y: auto;
            overflow-x: hidden;
            padding-right: clamp(3px, 1.4cqw, 16px);
            overscroll-behavior: contain;
            scrollbar-width: thin;
            scrollbar-color: #9aa7cb transparent;
          }

          .planissimo-agenda-scroll::-webkit-scrollbar {
            width: 8px;
          }

          .planissimo-agenda-scroll::-webkit-scrollbar-track {
            background: transparent;
          }

          .planissimo-agenda-scroll::-webkit-scrollbar-thumb {
            background: #9aa7cb;
            border-radius: 999px;
          }

          .planissimo-agenda-scroll::-webkit-scrollbar-thumb:hover {
            background: #2c3e70;
          }

          .planissimo-agenda-step {
            display: block;
            width: 100%;
            text-align: left;
            padding: clamp(6px, 1.1cqw, 12px);
            margin-bottom: clamp(6px, 1.2cqw, 14px);
            border: none;
            border-left: clamp(4px, 0.7cqw, 8px) solid transparent;
            background: transparent;
            color: #1f2233;
            cursor: pointer;
            font-family: 'Outfit', sans-serif;
            font-size: clamp(12px, 1.45cqw, 16px);
            font-weight: 500;
            overflow-wrap: anywhere;
          }

          .planissimo-agenda-step.is-active {
            border-left-color: #2c3e70;
            background: #eef1f9;
          }

          .planissimo-step-time {
            font-size: clamp(11px, 1.15cqw, 13px);
            color: #6b7280;
            margin-top: 4px;
          }

          .planissimo-focus {
            min-width: 0;
            min-height: 0;
            overflow: auto;
            border-left: 2px solid #2c3e70;
            padding-left: clamp(8px, 3cqw, 35px);
            font-size: clamp(12px, 1.45cqw, 16px);
            overflow-wrap: anywhere;
          }

          .planissimo-focus-title {
            color: #2c3e70;
            font-size: clamp(15px, 2cqw, 22px);
            line-height: 1.2;
            margin: 0 0 10px;
          }

          .planissimo-focus-time {
            margin-bottom: 10px;
            color: #6b7280;
          }

          .planissimo-objective {
            margin-bottom: clamp(12px, 2.2cqw, 25px);
          }

          .planissimo-timer-button {
            padding: clamp(6px, 0.9cqw, 10px)
                     clamp(8px, 1.6cqw, 18px);
            background: #2c3e70;
            color: white;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            font-family: 'Outfit', sans-serif;
            font-size: clamp(12px, 1.35cqw, 16px);
          }

          .planissimo-timer-value {
            display: inline-block;
            margin-left: clamp(6px, 1.5cqw, 18px);
            font-size: clamp(13px, 1.6cqw, 18px);
            font-weight: 600;
          }

          @container (max-width: 540px) {
            .planissimo-surface {
              border-radius: 10px;
            }

            .planissimo-workspace {
              grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr);
            }
          }
        `}
      </style>

      <div className="planissimo-outer">
        <div
          className="planissimo-surface"
          style={{
            background: timerComplete ? "#eef1f9" : "white",
            animation: completionPulse
              ? "planissimoTimerPulse 0.8s ease-in-out 3"
              : "none",
          }}
        >
          {/* FIXED HEADER AREA */}

          <div className="planissimo-header">
            <h1 className="planissimo-title">Planissimo</h1>

            <p className="planissimo-tagline">
              Where preparation becomes music.
            </p>

            {instances.length > 0 && (
              <div className="planissimo-selector-wrap">
                <select
                  className="planissimo-selector"
                  value={selectedInstance || ""}
                  onChange={(e) => {
                    clearTimerForStepChange();
                    setSelectedInstance(e.target.value);
                    setActiveStepIndex(null);
                  }}
                >
                  <option value="">Select Rehearsal</option>

                  {instances.map((instance, index) => {
                    const [ensemble, date] = instance.split("||");

                    return (
                      <option key={index} value={instance}>
                        {ensemble} — {formatDisplayDate(date)}
                      </option>
                    );
                  })}
                </select>
              </div>
            )}

            {selectedInstance && (
              <>
                <h2 className="planissimo-ensemble">
                  {ensembleName}
                </h2>

                <div className="planissimo-date">
                  {formatDisplayDate(displayDate)}
                </div>
              </>
            )}
          </div>

          {/* TWO-COLUMN REHEARSAL WORKSPACE */}

          {selectedInstance && (
            <div className="planissimo-workspace">
              {/* LEFT — INDEPENDENTLY SCROLLABLE AGENDA */}

              <div className="planissimo-agenda-scroll">
                {filteredData.map((row, index) => {
                  const isActive = index === activeStepIndex;

                  return (
                    <button
                      type="button"
                      key={index}
                      className={
                        "planissimo-agenda-step" +
                        (isActive ? " is-active" : "")
                      }
                      onClick={() => {
                        clearTimerForStepChange();
                        setActiveStepIndex(index);
                      }}
                    >
                      {row["Agenda Step"]}

                      <div className="planissimo-step-time">
                        {row["Time Allotted"]} minutes
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* RIGHT — REHEARSAL FOCUS */}

              <div className="planissimo-focus">
                {!activeStep && (
                  <div style={{ color: "#6b7280" }}>
                    Select a rehearsal focus.
                  </div>
                )}

                {activeStep && (
                  <>
                    <h3 className="planissimo-focus-title">
                      {activeStep["Agenda Step"]}
                    </h3>

                    <div className="planissimo-focus-time">
                      {activeStep["Time Allotted"]} minutes
                    </div>

                    <div className="planissimo-objective">
                      {activeStep["Objective"]}
                    </div>

                    {!activeTimer && !timerComplete && (
                      <button
                        type="button"
                        className="planissimo-timer-button"
                        onClick={() =>
                          startTimer(
                            Number(activeStep["Time Allotted"]) || 0
                          )
                        }
                      >
                        Start
                      </button>
                    )}

                    {activeTimer && (
                      <>
                        <button
                          type="button"
                          className="planissimo-timer-button"
                          onClick={
                            isPaused ? resumeTimer : pauseTimer
                          }
                        >
                          {isPaused ? "Resume" : "Pause"}
                        </button>

                        <span className="planissimo-timer-value">
                          {formatTime(remainingSeconds)}
                        </span>
                      </>
                    )}

                    {timerComplete && (
                      <span
                        className="planissimo-timer-value"
                        style={{ color: "#2c3e70", marginLeft: 0 }}
                      >
                        0:00
                      </span>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export default App;
