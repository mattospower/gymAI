// Resumos próprios; referências de técnica consultadas em 19/10/2026.
// Não são prescrições. Não são usados vídeos, fotografias ou textos copiados.
const ace = (id, slug) =>
  `https://www.acefitness.org/resources/everyone/exercise-library/${id}/${slug}/`;
export const exercises = [
  {
    id: "agachamento",
    name: "Agachamento com peso corporal",
    region: "Coxas e glúteos",
    equipment: ["peso-corporal"],
    equipmentText: "Peso corporal",
    category: "Agachar",
    description: "Flexão e extensão de quadris e joelhos em pé.",
    guidance:
      "Mantenha os pés apoiados e os joelhos acompanhando a direção dos pés. Desça com controle dentro de uma amplitude confortável.",
    source: ace(135, "bodyweight-squat"),
  },
  {
    id: "flexao",
    name: "Flexão de braços",
    region: "Peito, braços e ombros",
    equipment: ["peso-corporal"],
    equipmentText: "Peso corporal",
    category: "Empurrar",
    description: "Empurrar o chão com apoio das mãos e dos pés.",
    guidance:
      "Mantenha tronco e quadris alinhados. Controle a descida e a subida, sem deixar a região lombar ceder.",
    source: ace(41, "push-up"),
  },
  {
    id: "ponte",
    name: "Ponte de glúteos",
    region: "Glúteos e tronco",
    equipment: ["peso-corporal"],
    equipmentText: "Peso corporal",
    category: "Quadril",
    description: "Elevação dos quadris deitado com os pés apoiados.",
    guidance:
      "Apoie os pés e eleve os quadris com controle. Evite arquear excessivamente a lombar; retorne devagar ao chão.",
    source: ace(49, "glute-bridge"),
  },
  {
    id: "prancha",
    name: "Prancha frontal",
    region: "Abdômen e tronco",
    equipment: ["peso-corporal"],
    equipmentText: "Peso corporal",
    category: "Estabilidade",
    description: "Sustentação do tronco com apoio dos antebraços e dos pés.",
    guidance:
      "Alinhe ombros e cotovelos, mantenha o tronco estável e continue respirando. Interrompa se houver dor ou perda de controle.",
    source: ace(32, "front-plank"),
  },
  {
    id: "bird-dog",
    name: "Bird-dog",
    region: "Tronco, costas e glúteos",
    equipment: ["peso-corporal"],
    equipmentText: "Peso corporal",
    category: "Estabilidade",
    description:
      "Extensão alternada de braço e perna opostos em quatro apoios.",
    guidance:
      "Posicione mãos sob ombros e joelhos sob quadris. Movimente os membros sem girar o tronco ou arquear a lombar.",
    source: ace(14, "bird-dog"),
  },
  {
    id: "remada-halter",
    name: "Remada unilateral com halter",
    region: "Costas",
    equipment: ["halteres"],
    equipmentText: "Halter e banco estável",
    category: "Puxar",
    description: "Tração de um halter com apoio de mão e joelho em um banco.",
    guidance:
      "Confira a estabilidade do banco. Mantenha as costas alinhadas e evite girar o tronco para elevar a carga.",
    source: ace(126, "single-arm-row"),
  },
  {
    id: "rosca-halter",
    name: "Rosca de bíceps sentada",
    region: "Braços",
    equipment: ["halteres"],
    equipmentText: "Halteres e banco com encosto",
    category: "Braços",
    description: "Flexão dos cotovelos sentado com halteres.",
    guidance:
      "Mantenha os pés apoiados e os punhos alinhados. Movimente os cotovelos com controle, sem balançar o tronco.",
    source: ace(44, "seated-biceps-curl"),
  },
  {
    id: "puxada",
    name: "Puxada frontal na máquina",
    region: "Costas",
    equipment: ["maquinas"],
    equipmentText: "Máquina de puxada com apoio para coxas",
    category: "Puxar",
    description:
      "Tração de uma barra da máquina em direção à parte superior do peito.",
    guidance:
      "Ajuste o apoio das coxas. Controle a barra à frente do corpo e evite inclinar o tronco para trás durante a puxada.",
    source: ace(158, "seated-lat-pulldown"),
  },
  {
    id: "rosca-barra",
    name: "Rosca de bíceps com barra",
    region: "Braços",
    equipment: ["barras"],
    equipmentText: "Barra",
    category: "Braços",
    description: "Flexão dos cotovelos em pé segurando uma barra.",
    guidance:
      "Mantenha os cotovelos próximos ao tronco e os punhos alinhados. Retorne a barra com controle, sem usar balanços.",
    source: ace(70, "bicep-curl"),
  },
  {
    id: "rosca-elastico",
    name: "Rosca de bíceps com elástico",
    region: "Braços",
    equipment: ["elasticos"],
    equipmentText: "Elástico de resistência com pegadores",
    category: "Braços",
    description: "Flexão dos cotovelos contra a resistência de um elástico.",
    guidance:
      "Verifique a integridade e o apoio do elástico sob o pé. Mantenha os cotovelos próximos ao corpo e controle o retorno.",
    source: ace(322, "standing-bicep-curl"),
  },
];
export const exerciseById = new Map(
  exercises.map((exercise) => [exercise.id, exercise]),
);
