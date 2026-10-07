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

  // ---------- UI ----------

  return (
    <>
      <style>
        {`
          @keyframes planissimoTimerPulse {
            0% {
              background-color: #eef1f9;
            }

            50% {
              background-color: #cfd9f7;
            }

            100% {
              background-color: #eef1f9;
            }
          }

          .planissimo-agenda-scroll {
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
        `}
      </style>

      <div
        style={{
          height: "100vh",
          width: "100%",
          margin: 0,
          padding: "28px 32px",
          boxSizing: "border-box",
          overflow: "hidden",

          backgroundColor: "#2c3e70",

          backgroundImage: `
            radial-gradient(
              circle at 14% 22%,
              rgba(255,255,255,0.13) 0px,
              rgba(255,255,255,0.13) 3px,
              transparent 4px
            ),

            radial-gradient(
              circle at 84% 68%,
              rgba(255,255,255,0.10) 0px,
              rgba(255,255,255,0.10) 4px,
              transparent 5px
            ),

            repeating-linear-gradient(
              135deg,
              transparent 0px,
              transparent 54px,
              rgba(255,255,255,0.07) 54px,
              rgba(255,255,255,0.07) 56px,
              transparent 56px,
              transparent 108px
            ),

            repeating-linear-gradient(
              45deg,
              transparent 0px,
              transparent 145px,
              rgba(255,255,255,0.045) 145px,
              rgba(255,255,255,0.045) 147px,
              transparent 147px,
              transparent 290px
            ),

            linear-gradient(
              135deg,
              #22335f 0%,
              #2c3e70 50%,
              #38518a 100%
            )
          `,

          fontFamily: "'Outfit', sans-serif",
          color: "#1f2233",
        }}
      >
        <div
          style={{
            width: "100%",
            height: "100%",

            display: "flex",
            flexDirection: "column",

            background: timerComplete
              ? "#eef1f9"
              : "white",

            animation: completionPulse
              ? "planissimoTimerPulse 0.8s ease-in-out 3"
              : "none",

            border: "2px solid #2c3e70",
            borderRadius: "16px",

            padding: "48px 70px 42px",

            boxSizing: "border-box",
            overflow: "hidden",

            boxShadow:
              "0 12px 34px rgba(13, 24, 52, 0.30)",
          }}
        >
          {/* FIXED HEADER AREA */}

          <div
            style={{
              flex: "0 0 auto",
            }}
          >
            <h1
              style={{
                fontFamily: "'Righteous', sans-serif",
                fontSize: "46px",
                color: "#2c3e70",
                marginTop: 0,
                marginBottom: "6px",
                letterSpacing: "1px",
              }}
            >
              Planissimo
            </h1>

            <p
              style={{
                color: "#6b7280",
                marginTop: 0,
                marginBottom: "30px",
              }}
            >
              Where preparation becomes music.
            </p>

            {instances.length > 0 && (
              <div
                style={{
                  marginBottom: "26px",
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
                    marginTop: 0,
                    marginBottom: "4px",
                  }}
                >
                  {ensembleName}
                </h2>

                <div
                  style={{
                    marginBottom: "24px",
                    color: "#6b7280",
                  }}
                >
                  {formatDisplayDate(displayDate)}
                </div>
              </>
            )}
          </div>

          {/* FIXED WORKSPACE / SCROLLABLE AGENDA */}

          {selectedInstance && (
            <div
              style={{
                flex: "1 1 auto",
                minHeight: 0,

                display: "grid",
                gridTemplateColumns: "1fr 1.2fr",
                gap: "50px",

                overflow: "hidden",
              }}
            >
              {/* LEFT COLUMN — ONLY THIS SCROLLS */}

              <div
                className="planissimo-agenda-scroll"
                style={{
                  minHeight: 0,
                  overflowY: "auto",
                  overflowX: "hidden",

                  paddingRight: "16px",
                  overscrollBehavior: "contain",
                }}
              >
                {filteredData.map((row, index) => {
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
                        {row["Time Allotted"]} minutes
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* RIGHT COLUMN — STAYS PUT */}

              <div
                style={{
                  minHeight: 0,
                  overflow: "hidden",

                  borderLeft: "2px solid #2c3e70",
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
                        marginTop: 0,
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
                      {activeStep["Time Allotted"]} minutes
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
                                activeStep["Time Allotted"]
                              ) || 0
                            )
                          }
                          style={{
                            padding: "10px 18px",
                            background: "#2c3e70",
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
                            padding: "10px 18px",
                            background: "#2c3e70",
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
          )}
        </div>
      </div>
    </>
  );
}

export default App;
