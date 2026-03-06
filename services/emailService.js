"use strict";

/**
 * Email Service
 *
 * Sends transactional emails via AWS SES.
 * Requires: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION (or AWS_SES_REGION)
 * Optional: SES_FROM_EMAIL, SES_FROM_NAME (defaults from config)
 *
 * When email is not configured, password reset logs the link to console (dev).
 */

const { SESClient, SendEmailCommand } = require("@aws-sdk/client-ses");
const { APP_NAME } = require("../config");
const appName = APP_NAME || "HomeOps";

const region = process.env.AWS_SES_REGION || process.env.AWS_REGION || "us-east-1";
const credentials =
  process.env.AWS_SES_ACCESS_KEY_ID && process.env.AWS_SES_SECRET_ACCESS_KEY
    ? {
        accessKeyId: process.env.AWS_SES_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SES_SECRET_ACCESS_KEY,
      }
    : undefined;
const sesClient = new SESClient({ region, ...(credentials && { credentials }) });

function getFromAddress() {
  const email = process.env.SES_FROM_EMAIL;
  const name = process.env.SES_FROM_NAME || appName;
  if (!email) {
    throw new Error("SES_FROM_EMAIL not configured. Set it in .env (e.g. noreply@yourdomain.com)");
  }
  return `${name} <${email}>`;
}

function isSesConfigured() {
  return !!(
    process.env.SES_FROM_EMAIL &&
    (process.env.AWS_ACCESS_KEY_ID ||
      process.env.AWS_SES_ACCESS_KEY_ID ||
      process.env.AWS_PROFILE)
  );
}

async function sendViaSes({ to, subject, html }) {
  const command = new SendEmailCommand({
    Source: getFromAddress(),
    Destination: { ToAddresses: [to] },
    Message: {
      Subject: { Data: subject, Charset: "UTF-8" },
      Body: {
        Html: { Data: html, Charset: "UTF-8" },
      },
    },
  });

  await sesClient.send(command);
  return { success: true };
}

async function sendPasswordResetEmail({ to, resetUrl, userName }) {
  if (!isSesConfigured()) {
    throw new Error("SES not configured. Set SES_FROM_EMAIL and AWS credentials (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION)");
  }

  const html = `
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
      <h2 style="color: #456564;">Reset your password</h2>
      <p>Hi${userName ? ` ${userName}` : ""},</p>
      <p>We received a request to reset your ${appName} password. Click the button below to set a new password:</p>
      <p style="margin: 24px 0;">
        <a href="${resetUrl}" style="background-color: #456564; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">Reset Password</a>
      </p>
      <p style="color: #6b7280; font-size: 14px;">This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>
      <p style="color: #6b7280; font-size: 12px; margin-top: 32px;">— The ${appName} Team</p>
    </div>
  `;

  return sendViaSes({
    to,
    subject: `Reset your ${appName} password`,
    html,
  });
}

/**
 * Send invitation email with confirmation link.
 * @param {Object} opts - { to, inviteUrl, inviterName?, inviteeName?, type: 'account'|'property', propertyAddress? }
 */
async function sendInvitationEmail({ to, inviteUrl, inviterName, inviteeName, type = "account", propertyAddress }) {
  if (!isSesConfigured()) {
    throw new Error("SES not configured. Set SES_FROM_EMAIL and AWS credentials");
  }

  const isProperty = type === "property";
  const subject = isProperty
    ? `You've been invited to join a property${propertyAddress ? `: ${propertyAddress}` : ""}`
    : `You've been invited to join ${appName}`;

  const intro = inviteeName ? `Hi ${inviteeName},` : "Hi,";
  const inviterText = inviterName ? `${inviterName} has` : "Someone has";
  const contextText = isProperty
    ? (propertyAddress
        ? `${inviterText} invited you to join a property: ${propertyAddress}.`
        : `${inviterText} invited you to join a property.`)
    : `${inviterText} invited you to join ${appName}.`;

  const html = `
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
      <h2 style="color: #456564;">You're invited to ${appName}</h2>
      <p>${intro}</p>
      <p>${contextText} Click the button below to accept and set up your account:</p>
      <p style="margin: 24px 0;">
        <a href="${inviteUrl}" style="background-color: #456564; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">Accept invitation</a>
      </p>
      <p style="color: #6b7280; font-size: 14px;">This link expires in 48 hours. If you didn't expect this invite, you can safely ignore this email.</p>
      <p style="color: #6b7280; font-size: 12px; margin-top: 32px;">— The ${appName} Team</p>
    </div>
  `;

  return sendViaSes({ to, subject, html });
}

/**
 * Send contractor report request email with a link to fill out the maintenance report.
 * @param {Object} opts - { to, reportUrl, contractorName?, propertyAddress?, systemName?, senderName? }
 */
async function sendContractorReportEmail({ to, reportUrl, contractorName, propertyAddress, systemName, senderName }) {
  if (!isSesConfigured()) {
    throw new Error("SES not configured. Set SES_FROM_EMAIL and AWS credentials");
  }

  const greeting = contractorName ? `Hi ${contractorName},` : "Hi,";
  const requester = senderName ? senderName : "A homeowner";
  const propertyText = propertyAddress ? ` for the property at <strong>${propertyAddress}</strong>` : "";
  const systemText = systemName ? ` regarding <strong>${systemName}</strong>` : "";

  const subject = `${appName}: Maintenance report request${propertyAddress ? ` – ${propertyAddress}` : ""}`;
  const html = `
    <div style="font-family: sans-serif; max-width: 520px; margin: 0 auto;">
      <h2 style="color: #456564;">Maintenance Report Request</h2>
      <p>${greeting}</p>
      <p>${requester} has requested that you fill out a maintenance/inspection report${propertyText}${systemText}.</p>
      <p>Please click the button below to open the report form and provide your findings:</p>
      <p style="margin: 24px 0;">
        <a href="${reportUrl}" style="background-color: #456564; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">Fill Out Report</a>
      </p>
      <p style="color: #6b7280; font-size: 14px;">This link expires in 7 days. If you have questions, please contact the homeowner directly.</p>
      <p style="color: #6b7280; font-size: 12px; margin-top: 32px;">— The ${appName} Team</p>
    </div>
  `;

  return sendViaSes({ to, subject, html });
}

module.exports = {
  sendPasswordResetEmail,
  sendInvitationEmail,
  sendContractorReportEmail,
};
