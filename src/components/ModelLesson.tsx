"use client";

import { useState } from "react";

const examples = [
  { name: "Acierto apto", probability: 80, actual: true },
  { name: "Falsa alarma", probability: 80, actual: false },
  { name: "Apto no detectado", probability: 40, actual: true },
  { name: "Acierto no apto", probability: 40, actual: false },
];

export default function ModelLesson() {
  const [step, setStep] = useState(0);
  const [example, setExample] = useState(0);
  const current = examples[example];
  const predicted = current.probability >= 70;
  return (
    <section className="model-lesson" aria-labelledby="model-lesson-title">
      <h2 id="model-lesson-title">
        Cómo aprende y cómo comprobamos sus resultados
      </h2>
      <div
        className="lesson-steps"
        role="group"
        aria-label="Pasos de la demostración"
      >
        {[
          "Aprende de ejemplos",
          "Da una probabilidad",
          "Medimos los aciertos",
        ].map((label, index) => (
          <button
            key={label}
            type="button"
            aria-pressed={step === index}
            onClick={() => setStep(index)}
          >
            <span>{index + 1}</span>
            {label}
          </button>
        ))}
      </div>
      <p className="lesson-disclaimer">
        Ejemplos didácticos con datos inventados. Los resultados reales aparecen
        más abajo.
      </p>
      <div className="lesson-panel" aria-live="polite">
        {step === 0 && (
          <>
            <div className="lesson-learning">
              <div className="lesson-examples">
                <span className="lesson-caption">
                  DÍAS CON RESULTADO CONOCIDO
                </span>
                <div>
                  <span>
                    Viento suave
                    <br />
                    Sin lluvia
                  </span>
                  <b className="lesson-yes">✓ Apto</b>
                </div>
                <div>
                  <span>
                    Viento fuerte
                    <br />
                    Con lluvia
                  </span>
                  <b className="lesson-no">× No apto</b>
                </div>
                <div>
                  <span>
                    Viento suave
                    <br />
                    Con lluvia
                  </span>
                  <b className="lesson-no">× No apto</b>
                </div>
              </div>
              <span className="lesson-arrow" aria-hidden="true">
                →
              </span>
              <div className="lesson-model">
                <svg
                  viewBox="0 0 180 130"
                  role="img"
                  aria-label="Esquema de árboles que aprenden relaciones entre variables y resultados"
                >
                  <path
                    d="M90 28 V48 M90 48 H42 V72 M90 48 H138 V72 M42 84 V103 M138 84 V103"
                    fill="none"
                    stroke="#7b9b85"
                    strokeWidth="3"
                  />
                  <rect
                    x="46"
                    y="5"
                    width="88"
                    height="30"
                    rx="7"
                    fill="#e3eee3"
                  />
                  <text x="90" y="25" textAnchor="middle">
                    Viento, lluvia…
                  </text>
                  <rect
                    x="12"
                    y="65"
                    width="60"
                    height="24"
                    rx="6"
                    fill="#e3eee3"
                  />
                  <rect
                    x="108"
                    y="65"
                    width="60"
                    height="24"
                    rx="6"
                    fill="#f3e6dc"
                  />
                  <text x="42" y="81" textAnchor="middle">
                    Patrón A
                  </text>
                  <text x="138" y="81" textAnchor="middle">
                    Patrón B
                  </text>
                  <circle cx="42" cy="112" r="9" fill="#28664e" />
                  <circle cx="138" cy="112" r="9" fill="#b36b42" />
                </svg>
                <strong>Relaciona condiciones con aptitud</strong>
                <span>Aprende de muchos días anteriores.</span>
              </div>
            </div>
            <p>
              En los registros históricos calculamos si hubo horas suficientes
              para ensayar con los límites de viento y lluvia permitidos. El
              modelo usa esos ejemplos para aprender qué combinaciones se
              relacionan con un día apto.
            </p>
          </>
        )}
        {step === 1 && (
          <>
            <div
              className="lesson-outcomes"
              role="group"
              aria-label="Elegir un ejemplo de resultado"
            >
              {examples.map((item, index) => (
                <button
                  key={item.name}
                  type="button"
                  aria-pressed={example === index}
                  onClick={() => setExample(index)}
                >
                  {item.name}
                </button>
              ))}
            </div>
            <div className="lesson-prediction">
              <div>
                <span className="lesson-caption">EL MODELO DICE</span>
                <strong className="lesson-probability">
                  {current.probability}%
                </strong>
                <span>de probabilidad de día apto</span>
              </div>
              <div className="lesson-gauge">
                <div className="lesson-gauge-track">
                  <span style={{ width: `${current.probability}%` }} />
                  <i style={{ left: "70%" }} aria-hidden="true" />
                </div>
                <div className="lesson-gauge-labels">
                  <span>0%</span>
                  <strong>Corte: 70%</strong>
                  <span>100%</span>
                </div>
                <b className={predicted ? "lesson-yes" : "lesson-no"}>
                  Aviso: {predicted ? "apto" : "no apto"}
                </b>
              </div>
              <span className="lesson-arrow" aria-hidden="true">
                →
              </span>
              <div className="lesson-actual">
                <span className="lesson-caption">AL COMPROBAR EL DÍA</span>
                <b className={current.actual ? "lesson-yes" : "lesson-no"}>
                  {current.actual ? "✓ Fue apto" : "× No fue apto"}
                </b>
                <strong>{current.name}</strong>
              </div>
            </div>
            <p>
              <strong>80% no significa certeza.</strong> El corte del 70%
              convierte la probabilidad en un aviso. Elegí los ejemplos para ver
              cómo el mismo aviso puede acertar o equivocarse.
            </p>
          </>
        )}
        {step === 2 && (
          <>
            <div
              className="lesson-ten"
              role="img"
              aria-label="Ejemplo: diez días anunciados aptos; ocho realmente aptos y dos falsas alarmas"
            >
              <span className="lesson-caption">
                DE 10 DÍAS ANUNCIADOS APTOS…
              </span>
              <div>
                {Array.from({ length: 10 }, (_, i) => (
                  <span
                    key={i}
                    className={
                      i < 8 ? "lesson-day correct" : "lesson-day wrong"
                    }
                    aria-hidden="true"
                  >
                    {i < 8 ? "✓" : "×"}
                  </span>
                ))}
              </div>
              <p>
                8 aciertos <span>+ 2 falsas alarmas</span>
              </p>
            </div>
            <div className="lesson-score-bars">
              {[
                {
                  label: "Precisión",
                  value: 80,
                  text: "8 de los 10 avisos fueron correctos.",
                },
                {
                  label: "Recall",
                  value: 88.9,
                  text: "Si hubo 9 días aptos en total, detectamos 8 y se nos escapó 1.",
                },
                {
                  label: "F1",
                  value: 84.2,
                  text: "Combina ambas medidas: baja cuando una de ellas es baja.",
                },
              ].map((metric) => (
                <div key={metric.label}>
                  <strong>{metric.label}</strong>
                  <div className="lesson-score-track">
                    <span style={{ width: `${metric.value}%` }} />
                  </div>
                  <b>{Math.round(metric.value)}%</b>
                  <small>{metric.text}</small>
                </div>
              ))}
            </div>
            <p>
              Para el resumen real hacemos lo mismo con{" "}
              <strong>todos los casos históricos evaluados</strong>. La
              calibración comprueba además si las probabilidades anunciadas se
              parecen a lo que ocurrió.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
