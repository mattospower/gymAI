import {
  randomBytes,
  scrypt,
  timingSafeEqual,
  createHash,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { promisify } from "node:util";

const derive = promisify(scrypt);
const scryptOptions = { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
let activeHashes = 0;

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const token = () => randomBytes(32).toString("hex");
export const digest = (value) =>
  createHash("sha256").update(value).digest("hex");

// Bound memory used by expensive password operations, including concurrent requests.
async function passwordKey(password, salt) {
  if (activeHashes >= 2)
    throw new HttpError(
      503,
      "Muitas solicitações no momento. Tente novamente em instantes.",
    );
  activeHashes++;
  try {
    return await derive(password, salt, 64, scryptOptions);
  } finally {
    activeHashes--;
  }
}

export async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  return `scrypt$131072$8$1$${salt}$${(await passwordKey(password, salt)).toString("hex")}`;
}

export async function verifyPassword(password, hash) {
  const parts = hash.split("$");
  const expected = Buffer.from(parts[5], "hex");
  const actual = await passwordKey(password, parts[4]);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function encrypt(value, key, context) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(context));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), ciphertext]
    .map((part) => part.toString("base64"))
    .join(".");
}

export function decrypt(value, key, context) {
  const [iv, tag, ciphertext] = value
    .split(".")
    .map((part) => Buffer.from(part, "base64"));
  const cipher = createDecipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(context));
  cipher.setAuthTag(tag);
  return JSON.parse(
    Buffer.concat([cipher.update(ciphertext), cipher.final()]).toString("utf8"),
  );
}

export function text(value, label, max, min = 1) {
  if (
    typeof value !== "string" ||
    value.trim().length < min ||
    value.length > max
  ) {
    throw new HttpError(
      400,
      `Preencha ${label} corretamente (até ${max} caracteres).`,
    );
  }
  return value.trim();
}

export function email(value) {
  const normalized = text(value, "o e-mail", 254).toLowerCase();
  if (
    !/^[^\s@<>(),;:"\\]+@[^\s@<>(),;:"\\]+\.[^\s@<>(),;:"\\]+$/u.test(
      normalized,
    )
  ) {
    throw new HttpError(400, "Informe um endereço de e-mail válido.");
  }
  return normalized;
}

export function password(value, confirmation) {
  if (typeof value !== "string" || value.length < 15 || value.length > 128) {
    throw new HttpError(
      400,
      "Use uma senha entre 15 e 128 caracteres. Uma frase longa é uma boa opção.",
    );
  }
  if (value !== confirmation)
    throw new HttpError(400, "As senhas precisam ser iguais.");
  return value;
}

export function profile(input) {
  const oneOf = (value, values, label) => {
    if (!values.includes(value))
      throw new HttpError(400, `Selecione ${label}.`);
    return value;
  };
  const equipment = input.equipment;
  const allowed = [
    "halteres",
    "barras",
    "maquinas",
    "elasticos",
    "peso-corporal",
    "outros",
  ];
  if (
    !Array.isArray(equipment) ||
    !equipment.length ||
    equipment.length > 6 ||
    new Set(equipment).size !== equipment.length ||
    equipment.some((item) => !allowed.includes(item))
  ) {
    throw new HttpError(400, "Selecione pelo menos um equipamento disponível.");
  }
  const limitations = text(input.limitations ?? "", "as limitações", 2000, 0);
  if (limitations && input.sensitiveConsent !== true)
    throw new HttpError(
      400,
      "Autorize o armazenamento das limitações ou deixe o campo vazio.",
    );
  return {
    goal: oneOf(
      input.goal,
      ["hipertrofia", "forca", "resistencia", "condicionamento"],
      "seu objetivo",
    ),
    experience: oneOf(
      input.experience,
      ["iniciante", "intermediario", "avancado"],
      "sua experiência",
    ),
    days: oneOf(input.days, [1, 2, 3, 4, 5, 6, 7], "os dias por semana"),
    minutes: oneOf(
      input.minutes,
      [15, 30, 45, 60, 90, 120, 150, 180],
      "o tempo por sessão",
    ),
    location: oneOf(
      input.location,
      ["academia", "casa", "outro"],
      "o local do treino",
    ),
    equipment,
    otherEquipment: equipment.includes("outros")
      ? text(input.otherEquipment, "os outros equipamentos", 200)
      : "",
    limitations,
    sensitiveConsent: Boolean(limitations),
    sensitiveConsentAt: limitations ? new Date().toISOString() : null,
  };
}
