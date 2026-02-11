import express from 'express';
import Vendor from '../modals/vendor.model.js';
import mongoose from 'mongoose';
import { requireAuth } from '../middlewares/auth.middleware.js';

const router = express.Router();

// GET /vendors - list vendors (support company_id filter)
router.get("/", requireAuth, async (req, res, next) => {
    try {
        const { company_id } = req.query;
        let query = {};
        if (company_id && company_id !== 'all' && mongoose.Types.ObjectId.isValid(company_id)) {
            query.company_id = company_id;
        }

        const vendors = await Vendor.find(query).sort({ created_at: -1 });

        // Map to frontend format
        const formattedVendors = vendors.map(v => ({
            id: v._id,
            vendorName: v.name,
            email: v.email,
            contactNumber: v.contact,
            status: v.status,
            company_id: v.company_id,
            createdAt: v.created_at
        }));

        res.json({ vendors: formattedVendors });
    } catch (err) {
        next(err);
    }
});

// POST /vendors - add new vendor
router.post("/", requireAuth, async (req, res, next) => {
    try {
        const { vendorName, email, contactNumber, status, company_id } = req.body;

        if (!company_id) {
            return res.status(400).json({ error: "Company ID is required" });
        }

        const vendor = new Vendor({
            name: vendorName,
            email,
            contact: contactNumber,
            status: status || 'Active',
            company_id
        });

        await vendor.save();

        res.status(201).json({
            vendor: {
                id: vendor._id,
                vendorName: vendor.name,
                email: vendor.email,
                contactNumber: vendor.contact,
                status: vendor.status,
                company_id: vendor.company_id,
                createdAt: vendor.created_at
            }
        });
    } catch (err) {
        next(err);
    }
});

// PUT /vendors/:id - update vendor
router.put("/:id", requireAuth, async (req, res, next) => {
    try {
        const { id } = req.params;
        const { vendorName, email, contactNumber, status } = req.body;

        const vendor = await Vendor.findByIdAndUpdate(
            id,
            {
                name: vendorName,
                email,
                contact: contactNumber,
                status
            },
            { new: true }
        );

        if (!vendor) {
            return res.status(404).json({ error: "Vendor not found" });
        }

        res.json({
            vendor: {
                id: vendor._id,
                vendorName: vendor.name,
                email: vendor.email,
                contactNumber: vendor.contact,
                status: vendor.status,
                company_id: vendor.company_id,
                createdAt: vendor.created_at
            }
        });
    } catch (err) {
        next(err);
    }
});

// DELETE /vendors/:id - delete vendor
router.delete("/:id", requireAuth, async (req, res, next) => {
    try {
        const { id } = req.params;
        const vendor = await Vendor.findByIdAndDelete(id);

        if (!vendor) {
            return res.status(404).json({ error: "Vendor not found" });
        }

        res.json({ message: "Vendor deleted successfully" });
    } catch (err) {
        next(err);
    }
});
export default router;