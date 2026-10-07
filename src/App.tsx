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

  // Web Audio references for the two-note cue
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
        // The oscillator may already have finished.
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

      // A gentle ascending two-note cue.
      const notes = [
        {
          frequency: 523.25,
          startOffset: 0,
        },
        {
          frequency: 659.25,
          startOffset: 0.32,
        },
      ];

      notes.forEach(({ frequency, startOffset }) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();

        const noteStart = cueStart + startOffset;
        const noteEnd = noteStart + 0.3;

        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(frequency, noteStart);

        gain.gain.setValueAtTime(0.0001, noteStart);
        gain.gain.exponentialRampToValueAtTime(0.055, noteStart + 0.025);
        gain.gain.exponentialRampToValueAtTime(0.0001, noteEnd);

        oscillator.connect(gain);
        gain.connect(context.destination);

        oscillator.start(noteStart);
        oscillator.stop(noteEnd + 0.02);

        scheduledCueNodesRef.current.push(oscillator);
      });
    } catch {
      // If the browser blocks background audio,
      // the timer and visual completion state still work normally.
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
        }, 900);
      }
    };

    // Update immediately.
    updateTimer();

    // Frequent checks keep the visible timer smooth while this frame is active.
    timerIntervalRef.current = window.setInterval(updateTimer, 250);

    // These make the timer immediately catch up when the browser/frame
    // becomes active again after being throttled.
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

  // ---------- UI ----------

  return (
    <div
      style={{
        minHeight: "100vh",
        width: "100vw",
        margin: 0,
        padding: "18px",
        boxSizing: "border-box",

        // Deep-indigo wrapper with a faint staff-like texture.
        backgroundColor: "#2c3e70",
        backgroundImage: `
          repeating-linear-gradient(
            to bottom,
            rgba(255,255,255,0.045) 0px,
            rgba(255,255,255,0.045) 1px,
            transparent 1px,
            transparent 9px
          ),
          linear-gradient(
            135deg,
            #24345f 0%,
            #2c3e70 52%,
            #354d86 100%
          )
        `,

        fontFamily: "'Outfit', sans-serif",
        color: "#1f2233",
      }}
    >
      <div
        style={{
          width: "100%",
          minHeight: "calc(100vh - 36px)",

          // White normally, pale indigo after timer completion.
          background: completionPulse
            ? "#dbe4ff"
            : timerComplete
              ? "#eef1f9"
              : "white",

          border: "2px solid #2c3e70",
          borderRadius: "14px",

          padding: "60px 80px",
          boxSizing: "border-box",

          transition: completionPulse
            ? "background-color 180ms ease"
            : "background-color 500ms ease",

          boxShadow: "0 10px 30px rgba(18, 28, 55, 0.24)",
        }}
      >
        <h1
          style={{
            fontFamily: "'Righteous', sans-serif",
            fontSize: "46px",
            color: "#2c3e70",
            marginBottom: "6px",
            letterSpacing: "1px",
          }}
        >
          Planissimo
        </h1>

        <p
          style={{
            color: "#6b7280",
            marginBottom: "40px",
          }}
        >
          Where preparation becomes music.
        </p>

        {instances.length > 0 && (
          <div
            style={{
              marginBottom: "40px",
            }}
          >
            <select
              value={selectedInstance || ""}
              onChange={(e) => {
                clearTimerForStepChange();
                setSelectedInstance(e.target.value);
                setActiveStepIndex(null);
              }}
              style={{
                padding: "12px",
                borderRadius: "8px",
                border: "2px solid #2c3e70",
                width: "100%",
                fontSize: "16px",
                fontFamily: "'Outfit', sans-serif",
              }}
            >
              <option value="">
                Select Rehearsal
              </option>

              {instances.map((instance, index) => {
                const [ensemble, date] =
                  instance.split("||");

                return (
                  <option
                    key={index}
                    value={instance}
                  >
                    {ensemble} —{" "}
                    {formatDisplayDate(date)}
                  </option>
                );
              })}
            </select>
          </div>
        )}

        {selectedInstance && (
          <>
            <h2
              style={{
                color: "#2c3e70",
                marginBottom: "4px",
              }}
            >
              {ensembleName}
            </h2>

            <div
              style={{
                marginBottom: "30px",
                color: "#6b7280",
              }}
            >
              {formatDisplayDate(displayDate)}
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1.2fr",
                gap: "50px",
              }}
            >
              {/* LEFT COLUMN */}

              <div>
                {filteredData.map(
                  (row, index) => {
                    const isActive =
                      index === activeStepIndex;

                    return (
                      <div
                        key={index}
                        onClick={() => {
                          clearTimerForStepChange();
                          setActiveStepIndex(index);
                        }}
                        style={{
                          padding: "12px",
                          marginBottom: "14px",
                          cursor: "pointer",

                          borderLeft: isActive
                            ? "8px solid #2c3e70"
                            : "8px solid transparent",

                          background: isActive
                            ? "#eef1f9"
                            : "transparent",

                          fontWeight: 500,
                        }}
                      >
                        {row["Agenda Step"]}

                        <div
                          style={{
                            fontSize: "13px",
                            color: "#6b7280",
                            marginTop: "4px",
                          }}
                        >
                          {row["Time Allotted"]}{" "}
                          minutes
                        </div>
                      </div>
                    );
                  }
                )}
              </div>

              {/* RIGHT COLUMN */}

              <div
                style={{
                  borderLeft:
                    "2px solid #2c3e70",

                  paddingLeft: "35px",
                }}
              >
                {!activeStep && (
                  <div
                    style={{
                      color: "#6b7280",
                    }}
                  >
                    Select a rehearsal focus.
                  </div>
                )}

                {activeStep && (
                  <>
                    <h3
                      style={{
                        color: "#2c3e70",
                        marginBottom: "10px",
                      }}
                    >
                      {activeStep["Agenda Step"]}
                    </h3>

                    <div
                      style={{
                        marginBottom: "10px",
                        color: "#6b7280",
                      }}
                    >
                      {
                        activeStep[
                          "Time Allotted"
                        ]
                      }{" "}
                      minutes
                    </div>

                    <div
                      style={{
                        marginBottom: "25px",
                      }}
                    >
                      {activeStep["Objective"]}
                    </div>

                    {!activeTimer &&
                      !timerComplete && (
                        <button
                          onClick={() =>
                            startTimer(
                              Number(
                                activeStep[
                                  "Time Allotted"
                                ]
                              ) || 0
                            )
                          }
                          style={{
                            padding:
                              "10px 18px",

                            background:
                              "#2c3e70",

                            color: "white",
                            border: "none",
                            borderRadius: "8px",
                            cursor: "pointer",

                            fontFamily:
                              "'Outfit', sans-serif",
                          }}
                        >
                          Start
                        </button>
                      )}

                    {activeTimer && (
                      <>
                        <button
                          onClick={
                            isPaused
                              ? resumeTimer
                              : pauseTimer
                          }
                          style={{
                            padding:
                              "10px 18px",

                            background:
                              "#2c3e70",

                            color: "white",
                            border: "none",
                            borderRadius: "8px",
                            cursor: "pointer",

                            fontFamily:
                              "'Outfit', sans-serif",
                          }}
                        >
                          {isPaused
                            ? "Resume"
                            : "Pause"}
                        </button>

                        <span
                          style={{
                            marginLeft: "18px",
                            fontSize: "18px",
                            fontWeight: 600,
                          }}
                        >
                          {formatTime(
                            remainingSeconds
                          )}
                        </span>
                      </>
                    )}

                    {timerComplete && (
                      <span
                        style={{
                          display: "inline-block",
                          color: "#2c3e70",
                          fontWeight: 600,
                          fontSize: "18px",
                        }}
                      >
                        0:00
                      </span>
                    )}
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default App;
