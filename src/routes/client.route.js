import { Router } from "express";
import mongoose from "mongoose";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { User } from "../modals/user.model.js";
import { Client } from "../modals/client.model.js";

const router = Router();

// Middleware to get user from DB
async function attachUser(req, res, next) {
    try {
        const { uid } = req.auth;
        const user = await User.findOne({ firebase_uid: uid });
        if (!user) {
            return res.status(403).json({ message: "User not found" });
        }
        req.user = user;
        next();
    } catch (err) {
        next(err);
    }
}

// GET all clients (optionally filtered by company)
router.get("/", requireAuth, attachUser, async (req, res, next) => {
    try {
        const { company_id } = req.query;

        let query = {};

        // If not super admin, must filter by user's company
        if (req.user.role !== 0) {
            query.company_id = req.user.company_id;
        } else if (company_id && company_id !== "all") {
            // Super Admin can filter by company
            if (mongoose.Types.ObjectId.isValid(company_id)) {
                query.company_id = company_id;
            }
        }

        // If Super Admin and no company_id provided or "all", return all clients?
        // Based on the frontend logic, they seem to expect a list.

        const clients = await Client.find(query).sort({ created_at: -1 });
        return res.json({ clients });
    } catch (err) {
        next(err);
    }
});

// GET single client
router.get("/:id", requireAuth, attachUser, async (req, res, next) => {
    try {
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ message: "Invalid client ID" });
        }

        const query = { _id: id };

        if (req.user.role !== 0) {
            query.company_id = req.user.company_id;
        }

        const client = await Client.findOne(query);
        if (!client) return res.status(404).json({ message: "Client not found" });

        return res.json({ client });
    } catch (err) {
        next(err);
    }
});

// POST create client
router.post("/", requireAuth, attachUser, async (req, res, next) => {
    try {
        const { name, email, contact, logo, company_id } = req.body;

        if (!name) return res.status(400).json({ message: "Client name is required" });

        const target_company_id = req.user.role === 0 ? company_id : req.user.company_id;

        if (!target_company_id) {
            return res.status(400).json({ message: "Company ID is required" });
        }

        const client = await Client.create({
            name,
            email,
            contact,
            logo,
            company_id: target_company_id,
            created_by: req.user._id,
        });

        return res.status(201).json({ client });
    } catch (err) {
        next(err);
    }
});

// PUT update client
router.put("/:id", requireAuth, attachUser, async (req, res, next) => {
    try {
        const { id } = req.params;
        const { name, email, contact, logo } = req.body;

        const query = { _id: id };
        if (req.user.role !== 0) {
            query.company_id = req.user.company_id;
        }

        const client = await Client.findOneAndUpdate(query, {
            name,
            email,
            contact,
            logo
        }, { new: true });

        if (!client) return res.status(404).json({ message: "Client not found or unauthorized" });

        return res.json({ client });
    } catch (err) {
        next(err);
    }
});

// DELETE client
router.delete("/:id", requireAuth, attachUser, async (req, res, next) => {
    try {
        const { id } = req.params;

        const query = { _id: id };
        if (req.user.role !== 0) {
            query.company_id = req.user.company_id;
        }

        const result = await Client.findOneAndDelete(query);
        if (!result) return res.status(404).json({ message: "Client not found or unauthorized" });

        return res.json({ message: "Client deleted" });
    } catch (err) {
        next(err);
    }
});

export default router;
