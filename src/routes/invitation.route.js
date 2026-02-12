import crypto from "crypto";
import mongoose from "mongoose";
import { Router } from "express";
import { requireAuth, attachUser } from "../middlewares/auth.middleware.js";
import { User } from "../modals/user.model.js";
import { Invitation } from "../modals/invitation.model.js";
import { Team } from "../modals/team.model.js";
import { Company } from "../modals/company.model.js";
import { ENV } from "../config/env.js";
import { sendInvitationEmail } from "../services/mailer.js";
import { getAdminAuth } from "../config/firebaseAdmin.js";

const router = Router();

async function requireSuperAdmin(req, res, next) {
  try {
    const { uid } = req.auth;

    const user = await User.findOne({ $or: [{ firebase_uid: uid }, { firebaseUid: uid }] });
    if (!user) {
      return res.status(403).json({ message: "User is not provisioned in app database" });
    }

    if (user.role !== 0) {
      return res.status(403).json({ message: "Only SUPER_ADMIN can perform this action" });
    }

    req.user = user;
    return next();
  } catch (err) {
    return next(err);
  }
}

function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

const ROLE_LABEL_TO_ID = {
  "Recruiter Admin": 1,
  "Lead Recruiter": 2,
  Recruiter: 3,
};

function escapeRegex(input) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

router.get("/validate", async (req, res, next) => {
  try {
    const token = typeof req.query?.token === "string" ? req.query.token : "";
    if (!token) {
      return res.status(400).json({ message: "Missing token" });
    }

    const invitation = await Invitation.findOne({ token });
    if (!invitation) {
      return res.status(404).json({ message: "Invalid invitation token" });
    }

    if (invitation.expires_at && invitation.expires_at.getTime() < Date.now()) {
      return res.status(410).json({ message: "Invitation token expired" });
    }

    const company = await Company.findById(invitation.company_id).select("name");

    return res.json({
      invitation: {
        email: invitation.email,
        role: invitation.role,
        company_id: invitation.company_id,
        company_name: company?.name || null,
        team_id: invitation.team_id,
        expires_at: invitation.expires_at,
      },
    });
  } catch (err) {
    return next(err);
  }
});

router.post("/", requireAuth, attachUser, async (req, res, next) => {
  try {
    // Authorization: SuperAdmin (role 0), Recruiter Admin (role 1) or Lead Recruiter (role 2)
    if (req.user.role !== 0 && req.user.role !== 1 && req.user.role !== 2) {
      return res.status(403).json({ message: "You are not allowed to invite users" });
    }

    const { email, company_id, team_id, lead_recruiter_id, region, role } = req.body || {};

    if (!email || typeof email !== "string" || !email.trim()) {
      return res.status(400).json({ message: "Email is required" });
    }

    if (!company_id || !mongoose.Types.ObjectId.isValid(company_id)) {
      return res.status(400).json({ message: "Invalid company_id" });
    }

    // Recruiter Admin (1) and Lead Recruiter (2) can only invite to their own company
    if (req.user.role === 1 || req.user.role === 2) {
      if (!req.user.company_id) {
        return res.status(400).json({ message: "User is not associated with any company" });
      }
      if (company_id !== req.user.company_id.toString()) {
        return res.status(403).json({ message: "You can only invite users to your own company" });
      }
    }

    let roleId;
    if (typeof role === "number") {
      roleId = role;
    } else if (typeof role === "string") {
      roleId = ROLE_LABEL_TO_ID[role];
    }

    if (![1, 2, 3].includes(roleId)) {
      return res.status(400).json({ message: "Invalid role" });
    }

    // Default lead_recruiter_id if inviter is a Lead Recruiter
    let finalLeadRecruiterId = lead_recruiter_id;
    if (req.user.role === 2 && roleId === 3) {
      finalLeadRecruiterId = req.user._id;
    }

    let teamId = null;
    if (team_id !== undefined && team_id !== null && team_id !== "") {
      if (!mongoose.Types.ObjectId.isValid(team_id)) {
        return res.status(400).json({ message: "Invalid team_id" });
      }
      teamId = team_id;
    } else if (finalLeadRecruiterId && mongoose.Types.ObjectId.isValid(finalLeadRecruiterId)) {
      // Auto-lookup team based on lead_recruiter_id
      const team = await Team.findOne({ team_lead: finalLeadRecruiterId });
      if (team) {
        teamId = team._id;
      }
    }

    // Recruiter Admin cannot invite other Recruiter Admins
    if (req.user.role === 1 && roleId === 1) {
      return res.status(403).json({ message: "Recruiter Admin cannot invite other Recruiter Admins" });
    }

    const emailNormalized = email.trim().toLowerCase();

    // Prevent inviting an email that already has an account
    const existingMongoUser = await User.findOne({
      email: { $regex: new RegExp(`^${escapeRegex(emailNormalized)}$`, "i") },
    });
    if (existingMongoUser) {
      return res.status(409).json({ message: "Email already belongs to an existing user" });
    }

    try {
      await getAdminAuth().getUserByEmail(emailNormalized);
      return res.status(409).json({ message: "Email already has a Firebase account" });
    } catch (err) {
      // If Firebase user does not exist, continue.
      if (err?.code !== "auth/user-not-found") {
        return next(err);
      }
    }

    const token = generateToken();
    const expires_at = new Date(Date.now() + 48 * 60 * 60 * 1000);

    const invitationData = {
      email: emailNormalized,
      token,
      company_id,
      role: roleId,
      invited_by: req.user._id,
      expires_at,
    };

    // Only store recruiter-specific fields for Lead Recruiter (2) or Recruiter (3)
    if (roleId === 2 || roleId === 3) {
      invitationData.team_id = teamId;
      invitationData.lead_recruiter_id = finalLeadRecruiterId || null;
      invitationData.region = region || null;
    }

    const invitation = await Invitation.create(invitationData);

    const inviteUrl = `${ENV.FRONTEND_BASE_URL.replace(/\/$/, "")}/createaccount?token=${token}`;

    let mail_sent = false;
    let mail_error = null;

    try {
      await sendInvitationEmail({ to: emailNormalized, inviteUrl });
      mail_sent = true;
    } catch (mailErr) {
      mail_error = mailErr instanceof Error ? mailErr.message : "Failed to send email";
      console.error("[invitations] Failed to send invitation email", {
        to: emailNormalized,
        error: mail_error,
      });
    }

    return res.status(201).json({
      invitation: {
        id: invitation._id,
        email: invitation.email,
        token: invitation.token,
        company_id: invitation.company_id,
        team_id: invitation.team_id,
        role: invitation.role,
        invited_by: invitation.invited_by,
        expires_at: invitation.expires_at,
        created_at: invitation.created_at,
      },
      invite_url: inviteUrl,
      mail_sent,
      mail_error,
    });
  } catch (err) {
    if (err?.code === 11000) {
      const key = err?.keyPattern ? Object.keys(err.keyPattern)[0] : undefined;
      if (key === "token") {
        return res.status(409).json({ message: "Invitation token conflict, please retry" });
      }
      return res.status(409).json({ message: "Duplicate key error" });
    }

    return next(err);
  }
});

router.post("/accept", requireAuth, async (req, res, next) => {
  let invitation = null;
  let invitedEmail = "";

  try {
    const { token, name, contact } = req.body || {};

    if (!token || typeof token !== "string") {
      return res.status(400).json({ message: "Missing token" });
    }

    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ message: "Name is required" });
    }

    invitation = await Invitation.findOne({ token });
    if (!invitation) {
      return res.status(404).json({ message: "Invalid invitation token" });
    }

    if (invitation.expires_at && invitation.expires_at.getTime() < Date.now()) {
      return res.status(410).json({ message: "Invitation token expired" });
    }

    const authedEmail = (req.auth?.email || "").trim().toLowerCase();
    invitedEmail = (invitation.email || "").trim().toLowerCase();
    if (!authedEmail || authedEmail !== invitedEmail) {
      return res.status(403).json({ message: "Invitation email does not match authenticated user" });
    }

    const existingByUid = await User.findOne({
      $or: [{ firebase_uid: req.auth.uid }, { firebaseUid: req.auth.uid }],
    });
    if (existingByUid) {
      // Idempotency: if the user already exists for this Firebase uid, consume the invitation.
      await Invitation.deleteOne({ _id: invitation._id });
      return res.status(200).json({ user: existingByUid, consumed_invitation: true });
    }

    const existingByEmail = await User.findOne({
      email: { $regex: new RegExp(`^${escapeRegex(invitedEmail)}$`, "i") },
    });
    if (existingByEmail) {
      // Idempotency: email already provisioned; consume invitation to avoid repeated failures.
      await Invitation.deleteOne({ _id: invitation._id });
      return res.status(200).json({ user: existingByEmail, consumed_invitation: true });
    }

    const userPayload = {
      username: name.trim(),
      email: invitedEmail,
      contact: typeof contact === "string" ? contact.trim() : undefined,
      firebase_uid: req.auth.uid,
      company_id: invitation.company_id,
      role: invitation.role,
      created_by: invitation.invited_by || null,
    };

    // Only set recruiter-specific fields for roles 2 (Lead Recruiter) or 3 (Recruiter)
    if (invitation.role === 2 || invitation.role === 3) {
      if (invitation.team_id) userPayload.team_id = invitation.team_id;
      if (invitation.lead_recruiter_id) userPayload.lead_recruiter_id = invitation.lead_recruiter_id;
      if (invitation.region) userPayload.recruiter_region = invitation.region;
    }

    const created = await User.create(userPayload);

    // Team Logic
    if (created.role === 2) { // Lead Recruiter
      // Create a team for this lead recruiter
      const newTeam = await Team.create({
        name: `${created.username}'s Team`,
        company_id: created.company_id,
        team_lead: created._id,
        region: invitation.region || null,
        members: []
      });

      // Update user with the team_id
      created.team_id = newTeam._id;
      await created.save();
    } else if (created.role === 3) { // Recruiter
      const leadId = created.lead_recruiter_id || invitation.invited_by;
      if (leadId) {
        // Find the team of the lead recruiter
        const team = await Team.findOne({ team_lead: leadId });
        if (team) {
          created.team_id = team._id;
          if (!created.lead_recruiter_id) {
            created.lead_recruiter_id = leadId;
          }
          await created.save();

          // Add to team members if not already there
          const isMember = team.members.some(m => m.toString() === created._id.toString());
          if (!isMember) {
            team.members.push(created._id);
            await team.save();
          }
        }
      }
    }

    await Invitation.deleteOne({ _id: invitation._id });

    return res.status(201).json({ user: created });
  } catch (err) {
    if (err?.code === 11000) {
      const key = err?.keyPattern ? Object.keys(err.keyPattern)[0] : undefined;
      const normalizedKey = key === "firebaseUid" ? "firebase_uid" : key;

      console.error("[invitations/accept] duplicate key", {
        key,
        normalizedKey,
        auth_uid: req.auth?.uid,
        auth_email: req.auth?.email,
      });

      if (normalizedKey === "firebase_uid") {
        const existing = await User.findOne({
          $or: [{ firebase_uid: req.auth.uid }, { firebaseUid: req.auth.uid }],
        });
        if (invitation) {
          await Invitation.deleteOne({ _id: invitation._id });
        }
        if (existing) {
          return res.status(200).json({ user: existing, consumed_invitation: true });
        }
        return res.status(409).json({ message: "User already provisioned" });
      }

      if (normalizedKey === "email") {
        const existing = invitedEmail
          ? await User.findOne({ email: { $regex: new RegExp(`^${escapeRegex(invitedEmail)}$`, "i") } })
          : null;
        if (invitation) {
          await Invitation.deleteOne({ _id: invitation._id });
        }
        if (existing) {
          return res.status(200).json({ user: existing, consumed_invitation: true });
        }
        return res.status(409).json({ message: "User with this email already exists" });
      }

      return res.status(409).json({ message: `Duplicate key error${key ? ` (${key})` : ""}` });
    }

    return next(err);
  }
});

export default router;
