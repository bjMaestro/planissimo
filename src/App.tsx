import { useState, useEffect, useMemo, useRef } from "react";
import Papa from "papaparse";

const CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vS4IgUUEP_0stkksstahZ3-W20q0D55OT5HFZIkkhdquVjDkXvTOQmgJwC5JTsQntMHgGC-vltGQ_Gv/pub?output=csv";

function App() {
  const [data, setData] = useState<any[]>([]);
  const [instances, setInstances] = useState<string[]>([]);
  const [selectedInstance, setSelectedInstance] = useState<string | null>(null);
  const [activeStepIndex, setActiveStepIndex] = useState<number | null>(null);

  const [activeTimer, setActiveTimer] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [isPaused, setIsPaused] = useState(false);

  const timerRef = useRef<NodeJS.Timeout | null>(null);

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

  // ---------- FETCH ----------
  useEffect(() => {
    Papa.parse(CSV_URL, {
      download: true,
      header: true,
      complete: (results) => {
        const rows = results.data.filter((row: any) => row.Date);
        setData(rows);

        const rehearsalInstances = rows.map(
          (row: any) => `${row["Ensemble"]}||${row["Date"]}`
        );

        const uniqueInstances = [...new Set(rehearsalInstances)]
          .filter((instance) => {
            const [, date] = instance.split("||");
            return isThisWeek(date);
          })
          .sort((a, b) => {
            const [ensembleA, dateA] = a.split("||");
            const [ensembleB, dateB] = b.split("||");

            const dA = parseLocalDate(dateA).getTime();
            const dB = parseLocalDate(dateB).getTime();

            if (dA !== dB) return dA - dB;
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
    if (!selectedInstance) return [];
    const [ensemble, date] = selectedInstance.split("||");
    return data.filter(
      (row) => row["Date"] === date && row["Ensemble"] === ensemble
    );
  }, [data, selectedInstance]);

  const ensembleName = selectedInstance
    ? selectedInstance.split("||")[0]
    : "";

  const displayDate = selectedInstance
    ? selectedInstance.split("||")[1]
    : "";

  // ---------- TIMER ----------
  useEffect(() => {
    if (activeTimer && !isPaused && remainingSeconds > 0) {
      timerRef.current = setTimeout(() => {
        setRemainingSeconds((prev) => prev - 1);
      }, 1000);
    }

    if (remainingSeconds === 0 && activeTimer) {
      setActiveTimer(false);
      setIsPaused(false);
    }

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
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

  const activeStep =
    activeStepIndex !== null ? filteredData[activeStepIndex] : null;

  return (
    <div
      style={{
        background: "#f7f7f9",
        minHeight: "100vh",
        padding: "70px 20px",
        fontFamily: "'Outfit', sans-serif",
        color: "#1f2233",
      }}
    >
      <div
        style={{
          maxWidth: "1100px",
          margin: "0 auto",
          background: "white",
          border: "2px solid #2c3e70",
          borderRadius: "16px",
          padding: "50px",
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
              value={selectedInstance || ""}
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
            <h2 style={{ color: "#2c3e70", marginBottom: "4px" }}>
              {ensembleName}
            </h2>

            <div style={{ marginBottom: "30px", color: "#6b7280" }}>
              {formatDisplayDate(displayDate)}
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1.2fr",
                gap: "50px",
              }}
            >
              {/* LEFT */}
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

              {/* RIGHT */}
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
          </>
        )}
      </div>
    </div>
  );
}

export default App;
