import nodemailer from "nodemailer";

export function recoveryMailer(env) {
  if (
    ![env.SMTP_HOST, env.SMTP_USER, env.SMTP_PASSWORD, env.MAIL_FROM].every(
      Boolean,
    )
  )
    return null;
  const port = Number(env.SMTP_PORT || 587);
  if (![465, 587].includes(port))
    throw new Error("Use SMTP_PORT 465 ou 587 com TLS.");
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port,
    secure: port === 465,
    requireTLS: true,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
    connectionTimeout: 10000,
    socketTimeout: 15000,
    disableFileAccess: true,
    disableUrlAccess: true,
    logger: false,
    debug: false,
  });
  return ({ to, url }) =>
    transport.sendMail({
      from: env.MAIL_FROM,
      to,
      subject: "Redefina sua senha — gymAI",
      text: `Você solicitou uma nova senha para sua conta gymAI.\n\nAbra este link em até 30 minutos:\n${url}\n\nO link só pode ser usado uma vez. Se você não fez o pedido, ignore esta mensagem. Não compartilhe este link.`,
    });
}
