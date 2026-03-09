import { useState, useEffect, useMemo, useRef } from "react";
import Papa from "papaparse";

const CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vS4IgUUEP_0stkksstahZ3-W20q0D55OT5HFZIkkhdquVjDkXvTOQmgJwC5JTsQntMHgGC-vltGQ_Gv/pub?output=csv";

type Row = {
  Date: string;
  Ensemble: string;
  "Agenda Step": string;
  "Time Allotted": string;
  Objective: string;
  Notes?: string;
};

function App() {
  const [data, setData] = useState<Row[]>([]);
  const [instances, setInstances] = useState<string[]>([]);
  const [selectedInstance, setSelectedInstance] = useState<string | null>(null);
  const [activeStepIndex, setActiveStepIndex] = useState<number | null>(null);

  const [activeTimer, setActiveTimer] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [isPaused, setIsPaused] = useState(false);

  const timerRef = useRef<number | null>(null);

  // ---------- DATE HELPERS ----------

  const parseLocalDate = (dateString: string) => {
    const [y, m, d] = dateString.split("-").map(Number);
    return new Date(y, m - 1, d);
  };

  const getStartOfWeek = (date: Date) => {
    const copy = new Date(date);
    const day = copy.getDay();
    const diff = copy.getDate() - day + (day === 0 ? -6 : 1);
    return new Date(copy.getFullYear(), copy.getMonth(), diff);
  };

  const isThisWeek = (dateString: string) => {
    const today = new Date();
    const todayLocal = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate()
    );

    const start = getStartOfWeek(todayLocal);
    start.setHours(0, 0, 0, 0);

    const end = new Date(start);
    end.setDate(start.getDate() + 6);

    const date = parseLocalDate(dateString);

    return date >= start && date <= end;
  };

  const formatDisplayDate = (dateString: string) => {
    return parseLocalDate(dateString).toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
  };

  // ---------- FETCH CSV ----------

  useEffect(() => {
    Papa.parse<Row>(CSV_URL, {
      download: true,
      header: true,
      complete: (results) => {
        const rows = results.data.filter((r) => r.Date);
        setData(rows);

        const rehearsalInstances = rows.map(
          (r) => `${r.Ensemble}||${r.Date}`
        );

        const unique = Array.from(new Set(rehearsalInstances))
          .filter((instance) => {
            const [, date] = instance.split("||");
            return isThisWeek(date);
          })
          .sort((a, b) => {
            const [ea, da] = a.split("||");
            const [eb, db] = b.split("||");

            const timeA = parseLocalDate(da).getTime();
            const timeB = parseLocalDate(db).getTime();

            if (timeA !== timeB) return timeA - timeB;
            return ea.localeCompare(eb);
          });

        setInstances(unique);

        const today = new Date();
        const todayString = `${today.getFullYear()}-${String(
          today.getMonth() + 1
        ).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

        const todays = unique.filter((i) =>
          i.endsWith(`||${todayString}`)
        );

        if (todays.length === 1) {
          setSelectedInstance(todays[0]);
        } else {
          setSelectedInstance(null);
        }
      },
    });
  }, []);

  const filteredData = useMemo(() => {
    if (!selectedInstance) return [];
    const [ensemble, date] = selectedInstance.split("||");
    return data.filter(
      (r) => r.Date === date && r.Ensemble === ensemble
    );
  }, [data, selectedInstance]);

  const activeStep =
    activeStepIndex !== null ? filteredData[activeStepIndex] : null;

  // ---------- TIMER ----------

  useEffect(() => {
    if (activeTimer && !isPaused && remainingSeconds > 0) {
      timerRef.current = window.setTimeout(() => {
        setRemainingSeconds((prev) => prev - 1);
      }, 1000);
    }

    if (remainingSeconds === 0 && activeTimer) {
      setActiveTimer(false);
      setIsPaused(false);
    }

    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [remainingSeconds, activeTimer, isPaused]);

  const startTimer = (minutes: number) => {
    setRemainingSeconds(minutes * 60);
    setActiveTimer(true);
    setIsPaused(false);
  };

  const pauseTimer = () => setIsPaused(true);
  const resumeTimer = () => setIsPaused(false);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  // ---------- UI ----------

  return (
    <div
      style={{
        background: "#f7f7f9",
        minHeight: "100vh",
        fontFamily: "'Outfit', sans-serif",
        color: "#1f2233",
      }}
    >
      <div
        style={{
          width: "100%",
          minHeight: "100vh",
          background: "white",
          borderLeft: "4px solid #2c3e70",
          borderRight: "4px solid #2c3e70",
          padding: "60px 80px",
          boxSizing: "border-box",
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

        <p style={{ color: "#6b7280", marginBottom: "40px" }}>
          Where preparation becomes music.
        </p>

        {instances.length > 0 && (
          <div style={{ marginBottom: "40px" }}>
            <select
              value={selectedInstance ?? ""}
              onChange={(e) => {
                setSelectedInstance(e.target.value);
                setActiveStepIndex(null);
              }}
              style={{
                padding: "12px",
                borderRadius: "8px",
                border: "2px solid #2c3e70",
                width: "100%",
                fontSize: "16px",
              }}
            >
              <option value="">Select Rehearsal</option>
              {instances.map((instance, i) => {
                const [ensemble, date] = instance.split("||");
                return (
                  <option key={i} value={instance}>
                    {ensemble} — {formatDisplayDate(date)}
                  </option>
                );
              })}
            </select>
          </div>
        )}

        {selectedInstance && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1.2fr",
              gap: "50px",
            }}
          >
            <div>
              {filteredData.map((row, index) => {
                const isActive = index === activeStepIndex;

                return (
                  <div
                    key={index}
                    onClick={() => {
                      setActiveStepIndex(index);
                      setActiveTimer(false);
                      setIsPaused(false);
                    }}
                    style={{
                      padding: "12px",
                      marginBottom: "14px",
                      cursor: "pointer",
                      borderLeft: isActive
                        ? "8px solid #2c3e70"
                        : "8px solid transparent",
                      background: isActive ? "#eef1f9" : "transparent",
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

            <div
              style={{
                borderLeft: "2px solid #2c3e70",
                paddingLeft: "35px",
              }}
            >
              {!activeStep && (
                <div style={{ color: "#6b7280" }}>
                  Select a rehearsal focus.
                </div>
              )}

              {activeStep && (
                <>
                  <h3 style={{ color: "#2c3e70", marginBottom: "10px" }}>
                    {activeStep["Agenda Step"]}
                  </h3>

                  <div style={{ marginBottom: "10px", color: "#6b7280" }}>
                    {activeStep["Time Allotted"]} minutes
                  </div>

                  <div style={{ marginBottom: "25px" }}>
                    {activeStep["Objective"]}
                  </div>

                  {!activeTimer && (
                    <button
                      onClick={() =>
                        startTimer(Number(activeStep["Time Allotted"]) || 0)
                      }
                      style={{
                        padding: "10px 18px",
                        background: "#2c3e70",
                        color: "white",
                        border: "none",
                        borderRadius: "8px",
                        cursor: "pointer",
                      }}
                    >
                      Start
                    </button>
                  )}

                  {activeTimer && (
                    <>
                      <button
                        onClick={isPaused ? resumeTimer : pauseTimer}
                        style={{
                          padding: "10px 18px",
                          background: "#2c3e70",
                          color: "white",
                          border: "none",
                          borderRadius: "8px",
                          cursor: "pointer",
                        }}
                      >
                        {isPaused ? "Resume" : "Pause"}
                      </button>

                      <span
                        style={{
                          marginLeft: "18px",
                          fontSize: "18px",
                          fontWeight: 600,
                        }}
                      >
                        {formatTime(remainingSeconds)}
                      </span>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
