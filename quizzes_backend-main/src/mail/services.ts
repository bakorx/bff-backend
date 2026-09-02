import { render } from "@react-email/render";
import { CONFIG, logger, transporter } from "@/config";
import { MailOptions } from "./interfaces";
import {maskEmail, maskId} from "@/utils"

export async function sendMail(opts: MailOptions) {
  try {
    const { to, subject, template, fromName, fromEmail, attachments } = opts;
    const html = await render(template);

    const mailOptions = {
      from: `"${fromName || CONFIG.SMTP.FROM_NAME || "Qz"}" <${
        fromEmail || CONFIG.SMTP.FROM_EMAIL || CONFIG.SMTP.USER
      }>`,
      to,
      subject,
      html,
      ...(attachments && { attachments }),
    };

    const info = await transporter.sendMail(mailOptions);

    logger.info(
      `[Mail] Sent to ${maskEmail(to)}. ID: ${maskId(info.messageId)}`,
    );

    return info;
  } catch (error: any) {
    logger.error(`[Mail] Failed to send mail to ${maskEmail(opts.to)}`, error);
    throw error;
  }
}
