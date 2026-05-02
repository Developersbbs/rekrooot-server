import { Router } from "express";
import nodemailer from "nodemailer";
import { ENV } from "../config/env.js";

const router = Router();

router.post("/send-interview-slot", async (req, res, next) => {
    try {
        const {
            type,
            candidateEmail,
            candidateName,
            recruiterEmail,
            vendorEmail,
            jobTitle,
            clientName,
            interviewerName,
            selectedTimeSlot,
            sendDirectInvitation,
            link
        } = req.body;

        if (!candidateEmail || (!link && !sendDirectInvitation && type !== 'cancel')) {
            return res.status(400).json({ message: "Missing required fields" });
        }

        const transporter = nodemailer.createTransport({
            host: ENV.SMTP_HOST,
            port: ENV.SMTP_PORT,
            secure: ENV.SMTP_SECURE,
            auth: {
                user: ENV.INTERVIEW_SMTP_USER,
                pass: ENV.INTERVIEW_SMTP_PASS
            }
        });

        const ccList = [recruiterEmail, vendorEmail].filter(email => email);

        let subject = "";
        let html = "";

        if (type === 'cancel') {
            subject = `Interview Cancelled - ${candidateName} for ${jobTitle}`;
            html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Interview Cancelled</title><style>body{font-family:Arial,sans-serif;margin:0;padding:0;background-color:#f4f4f4}.container{background-color:#fff;margin:0 auto;padding:20px;max-width:600px;border-radius:8px;box-shadow:0 0 10px rgba(0,0,0,.1)}.header{background-color:#d32f2f;color:#fff;padding:20px;text-align:center;border-top-left-radius:8px;border-top-right-radius:8px}.header h1{margin:0;font-size:24px}.content{padding:20px;color:#333;line-height:1.6}.content p{margin:0 0 10px}.footer{text-align:center;color:#777;font-size:12px;margin-top:20px}h2{color:#333;margin-top:20px}.cancel-box{background-color:#fffef0;border-left:4px solid #d32f2f;padding:15px;margin:20px 0;border-radius:4px}</style></head><body><div class="container"><div class="header"><img width="100" src="https://firebasestorage.googleapis.com/v0/b/x-talento-new.appspot.com/o/assets%2Flogo.png?alt=media&token=0e681b04-04b6-4ebc-855e-dfcc3f9acabe" alt="rekrooot-img"><h1>Interview Cancelled</h1></div><div class="content"><h2>Dear <strong>${candidateName}</strong>,</h2><p>This is to inform you that your interview for the <strong>${jobTitle}</strong> position with <strong>${clientName}</strong> has been <strong>cancelled</strong>.</p><div class="cancel-box"><strong>Position:</strong> ${jobTitle}<br><strong>Company:</strong> ${clientName}</div><p>We apologize for any inconvenience this may have caused. If you have any questions, please contact us at <a href="mailto:hr@rekrooot.com">hr@rekrooot.com</a>.</p><p>Best regards,<br>The Rekrooot Interview Panel</p></div><div class="footer"><p> © 2026 <a href="#">Rekrooot</a> | All rights reserved.</p></div></div></body></html>`;
        } else if (type === 'declined') {
            subject = `Application Update - ${candidateName} for ${jobTitle}`;
            html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Application Update</title><style>body{font-family:Arial,sans-serif;margin:0;padding:0;background-color:#f4f4f4}.container{background-color:#fff;margin:0 auto;padding:20px;max-width:600px;border-radius:8px;box-shadow:0 0 10px rgba(0,0,0,.1)}.header{background-color:#2f4858;color:#fff;padding:20px;text-align:center;border-top-left-radius:8px;border-top-right-radius:8px}.header h1{margin:0;font-size:24px}.content{padding:20px;color:#333;line-height:1.6}.content p{margin:0 0 10px}.footer{text-align:center;color:#777;font-size:12px;margin-top:20px}h2{color:#333;margin-top:20px}.info-box{background-color:#f0f9ff;border-left:4px solid #2f4858;padding:15px;margin:20px 0;border-radius:4px}</style></head><body><div class="container"><div class="header"><img width="100" src="https://firebasestorage.googleapis.com/v0/b/x-talento-new.appspot.com/o/assets%2Flogo.png?alt=media&token=0e681b04-04b6-4ebc-855e-dfcc3f9acabe" alt="rekrooot-img"><h1>Application Update</h1></div><div class="content"><h2>Dear <strong>${candidateName}</strong>,</h2><p>Thank you for your interest in the <strong>${oldJobTitle}</strong> position with <strong>${oldClientName}</strong>.</p><p>We would like to inform you that your application for this specific role has been <strong>declined</strong> as you have recently applied for a different position within our recruitment portal.</p><div class="info-box"><strong>Previous Role:</strong> ${oldJobTitle}<br><strong>Status:</strong> Discontinued in favor of new application</div><p>We will proceed with your most recent application and will keep you updated on its progress.</p><p>If you have any questions, please contact us at <a href="mailto:hr@rekrooot.com">hr@rekrooot.com</a>.</p><p>Best regards,<br>The Rekrooot Recruitment Team</p></div><div class="footer"><p> © 2026 <a href="#">Rekrooot</a> | All rights reserved.</p></div></div></body></html>`;
        } else if (sendDirectInvitation) {
            subject = `Interview Invitation - ${candidateName} for ${jobTitle}`;
            html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Interview Invitation</title><style>body{font-family:Arial,sans-serif;margin:0;padding:0;background-color:#f4f4f4}.container{background-color:#fff;margin:0 auto;padding:20px;max-width:600px;border-radius:8px;box-shadow:0 0 10px rgba(0,0,0,.1)}.header{background-color:#2f4858;color:#fff;padding:20px;text-align:center;border-top-left-radius:8px;border-top-right-radius:8px}.header h1{margin:0;font-size:24px}.content{padding:20px;color:#333;line-height:1.6}.content p{margin:0 0 10px}.button{text-align:center;margin:20px 0}.button a{background-color:#2f4858;color:#fff;padding:12px 20px;text-decoration:none;border-radius:4px;font-size:16px}.button a:hover{color:#2f4858;background-color:#fb8404}.footer{text-align:center;color:#777;font-size:12px;margin-top:20px}h2{color:#333;margin-top:20px}ul{margin:10px 0;padding-left:20px}li{margin-bottom:5px}.highlight-box{background-color:#f0f9ff;border-left:4px solid:#2f4858;padding:15px;margin:20px 0;border-radius:4px}</style></head><body><div class="container"><div class="header"><img width="100" src="https://firebasestorage.googleapis.com/v0/b/x-talento-new.appspot.com/o/assets%2Flogo.png?alt=media&token=0e681b04-04b6-4ebc-855e-dfcc3f9acabe" alt="rekrooot-img"><h1>Interview Invitation</h1></div><div class="content"><h2>Dear <strong>${candidateName}</strong>,</h2><p>We hope you're doing great! We're thrilled to let you know that you've been <strong>shortlisted</strong> for the <strong>${jobTitle}</strong> position with <strong>${clientName}</strong>. You've made it to this important step in the hiring process—<strong>congratulations</strong> on your achievement!</p><p>We are pleased to inform you that your interview has been <strong>scheduled</strong> for the following time:</p><div class="highlight-box"><strong>Interview Time:</strong> ${selectedTimeSlot}<br><strong>Interviewer:</strong> ${interviewerName || 'Interviewer'}</div>${link ? `<p>Please join the interview using the link below at the scheduled time:</p><div class="button"><a href="${link}" target="_blank">Join Interview</a></div>` : ''}<h2>Interview Guidelines</h2><ul><li>Make sure you have a <strong>laptop with a working camera</strong>.</li><li>Set up in a <strong>well-lit</strong> space for clear visibility.</li><li><strong>Share your desktop</strong> during the interview and avoid external assistance.</li><li>Close all background applications; using <strong>remote connections</strong> or dual monitors is not allowed.</li><li>Ensure you have a <strong>strong internet connection</strong> and a webcam.</li><li>The interview will be <strong>recorded</strong> and will include coding and theoretical questions.</li><li>Please connect using a <strong>laptop or desktop</strong>—handheld devices aren't allowed.</li></ul><h2>Identification Verification</h2><p>As part of our process, we'll require a quick <strong>photo ID verification</strong> during the interview.</p><p>If you have any questions or need clarification before the interview, feel free to reach out to us at <a href="mailto:hr@rekrooot.com">hr@rekrooot.com</a>.</p><p>We're looking forward to seeing you in the interview. Best of luck in your preparations—we know you'll do great!</p><p>Best regards,<br>The Rekrooot Interview Panel</p></div><div class="footer"><p> 2026 <a href="#">Rekrooot</a> | All rights reserved.</p></div></div></body></html>`;
        } else {
            subject = `Interview Scheduling - ${candidateName} for ${jobTitle} at ${clientName}`;
            html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Email Invitation</title><style>body{font-family:Arial,sans-serif;margin:0;padding:0;background-color:#f4f4f4}.container{background-color:#fff;margin:0 auto;padding:20px;max-width:600px;border-radius:8px;box-shadow:0 0 10px rgba(0,0,0,.1)}.header{background-color:#2f4858;color:#fff;padding:20px;text-align:center;border-top-left-radius:8px;border-top-right-radius:8px}.header h1{margin:0;font-size:24px}.content{padding:20px;color:#333;line-height:1.6}.content p{margin:0 0 10px}.button{text-align:center;margin:20px 0}.button a{background-color:#2f4858;color:#fff;padding:12px 20px;text-decoration:none;border-radius:4px;font-size:16px}.button a:hover{color:#2f4858;background-color:#fb8404}.footer{text-align:center;color:#777;font-size:12px;margin-top:20px}h2{color:#333;margin-top:20px}ul{margin:10px 0;padding-left:20px}li{margin-bottom:5px}</style></head><body><div class="container"><div class="header"><img width="100" src="https://firebasestorage.googleapis.com/v0/b/x-talento-new.appspot.com/o/assets%2Flogo.png?alt=media&token=0e681b04-04b6-4ebc-855e-dfcc3f9acabe" alt="rekrooot-img"><h1>Interview Invitation</h1></div><div class="content"><h2>Dear <strong>${candidateName}</strong>,</h2><p>We hope you're doing great! We're thrilled to let you know that you've been <strong>shortlisted</strong> for the <strong>L1 Technical Interview</strong> with <strong>Rekrooot</strong> on behalf of <strong>${clientName}</strong>. You've made it to this important step in the hiring process—<strong>congratulations</strong> on your achievement!</p><p>Please select your preferred interview time slot using the link below:</p><div class="button"><a href="${link}" target="_blank">Select Your Interview Timeslot</a></div><h2>Interview Guidelines</h2><ul><li>Make sure you have a <strong>laptop with a working camera</strong>.</li><li>Set up in a <strong>well-lit</strong> space for clear visibility.</li><li><strong>Share your desktop</strong> during the interview and avoid external assistance.</li><li>Close all background applications; using <strong>remote connections</strong> or dual monitors is not allowed.</li><li>Ensure you have a <strong>strong internet connection</strong> and a webcam.</li><li>The interview will be <strong>recorded</strong> and will include coding and theoretical questions.</li><li>Please connect using a <strong>laptop or desktop</strong>—handheld devices aren't allowed.</li></ul><h2>Identification Verification</h2><p>As part of our process, we'll require a quick <strong>photo ID verification</strong> during the interview.</p><p>Once you've chosen your time slot, you'll receive an official interview invite with all the necessary details, including the link to join the session.</p><p>If you have any questions or need clarification before the interview, feel free to reach out to us at <a href="mailto:hr@rekrooot.com">hr@rekrooot.com</a>.</p><p>We're looking forward to seeing you in the L1 Technical Interview. Best of luck in your preparations—we know you'll do great!</p><p>Best regards,<br>The Rekrooot Interview Panel</p></div><div class="footer"><p> 2026 <a href="#">Rekrooot</a> | All rights reserved.</p></div></div></body></html>`;
        }

        const fromAddress = `"Rekrooot Interview" <${ENV.INTERVIEW_MAIL_FROM}>`;
        console.log("Attempting to send mail with:", {
            from: fromAddress,
            to: candidateEmail,
            cc: ccList
        });

        try {
            await transporter.sendMail({
                from: ENV.INTERVIEW_MAIL_FROM, // Simplified from address
                to: candidateEmail,
                cc: ccList,
                subject,
                html
            });
            console.log("Email sent successfully to:", candidateEmail);
        } catch (mailError) {
            console.error("SMTP RELAY ERROR:", {
                message: mailError.message,
                response: mailError.response,
                from: ENV.INTERVIEW_MAIL_FROM,
                authUser: ENV.INTERVIEW_SMTP_USER
            });
            throw mailError;
        }

        return res.json({ success: true, message: "Email sent successfully" });
    } catch (err) {
        next(err);
    }
});

export default router;
