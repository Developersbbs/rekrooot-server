import express from 'express';
import Vendor from '../modals/vendor.model.js';
import { Candidate } from '../modals/candidate.model.js';
import mongoose from 'mongoose';
import { requireAuth, attachUser } from '../middlewares/auth.middleware.js';

const router = express.Router();

// GET /vendors/:id/public (public endpoint)
router.get("/:id/public", async (req, res, next) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: "Invalid ID" });
        }

        const vendor = await Vendor.findById(id).select("email name");
        if (!vendor) {
            return res.status(404).json({ error: "Vendor not found" });
        }
        return res.json({ vendor });
    } catch (err) {
        next(err);
    }
});

// GET /vendors - list vendors (support company_id filter)
router.get("/", requireAuth, attachUser, async (req, res, next) => {
    try {
        const { company_id, created_by } = req.query;
        let query = {};
        if (company_id && company_id !== 'all' && mongoose.Types.ObjectId.isValid(company_id)) {
            query.company_id = company_id;
        }
        if (created_by && mongoose.Types.ObjectId.isValid(created_by)) {
            query.created_by = created_by;
        }

        const vendors = await Vendor.find(query)
            .populate('created_by', '_id username email')
            .sort({ created_at: -1 });

        // Get candidate counts for each vendor
        const vendorIds = vendors.map(v => v._id);
        const candidateCounts = await Candidate.aggregate([
            {
                $match: {
                    vendor_id: { $in: vendorIds },
                    trash: { $ne: true }
                }
            },
            {
                $group: {
                    _id: '$vendor_id',
                    count: { $sum: 1 }
                }
            }
        ]);

        // Create a map of vendor_id to candidate count
        const countMap = candidateCounts.reduce((acc, item) => {
            acc[item._id.toString()] = item.count;
            return acc;
        }, {});

        // Map to frontend format
        const formattedVendors = vendors.map(v => ({
            id: v._id,
            vendorName: v.name,
            email: v.email,
            contactNumber: v.contact,
            status: v.status,
            company_id: v.company_id,
            createdAt: v.created_at,
            createdBy: v.created_by,
            candidateCount: countMap[v._id.toString()] || 0
        }));

        res.json({ vendors: formattedVendors });
    } catch (err) {
        next(err);
    }
});

// GET /vendors/:id - single vendor
router.get("/:id", requireAuth, attachUser, async (req, res, next) => {
    try {
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: "Invalid vendor ID" });
        }

        const vendor = await Vendor.findById(id).populate('created_by', '_id username email');

        if (!vendor) {
            return res.status(404).json({ error: "Vendor not found" });
        }

        // Get candidate count for this vendor
        const candidateCount = await Candidate.countDocuments({
            vendor_id: vendor._id,
            trash: { $ne: true }
        });

        res.json({
            vendor: {
                id: vendor._id,
                vendorName: vendor.name,
                email: vendor.email,
                contactNumber: vendor.contact,
                status: vendor.status,
                company_id: vendor.company_id,
                createdAt: vendor.created_at,
                createdBy: vendor.created_by,
                candidateCount
            }
        });
    } catch (err) {
        next(err);
    }
});

// POST /vendors - add new vendor
router.post("/", requireAuth, attachUser, async (req, res, next) => {
    try {
        const { vendorName, email, contactNumber, status, company_id } = req.body;

        if (!company_id) {
            return res.status(400).json({ error: "Company ID is required" });
        }

        const vendor = new Vendor({
            name: vendorName,
            email,
            contact: contactNumber,
            status: status || '0',
            company_id,
            created_by: req.user.id
        });

        await vendor.save();

        // Populate created_by for response
        await vendor.populate('created_by', '_id username email');

        res.status(201).json({
            vendor: {
                id: vendor._id,
                vendorName: vendor.name,
                email: vendor.email,
                contactNumber: vendor.contact,
                status: vendor.status,
                company_id: vendor.company_id,
                createdAt: vendor.created_at,
                createdBy: vendor.created_by,
                candidateCount: 0
            }
        });
    } catch (err) {
        next(err);
    }
});

// PUT /vendors/:id - update vendor
router.put("/:id", requireAuth, attachUser, async (req, res, next) => {
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
        ).populate('created_by', '_id username email');

        if (!vendor) {
            return res.status(404).json({ error: "Vendor not found" });
        }

        // Get candidate count for this vendor
        const candidateCount = await Candidate.countDocuments({
            vendor_id: vendor._id,
            trash: { $ne: true }
        });

        res.json({
            vendor: {
                id: vendor._id,
                vendorName: vendor.name,
                email: vendor.email,
                contactNumber: vendor.contact,
                status: vendor.status,
                company_id: vendor.company_id,
                createdAt: vendor.created_at,
                createdBy: vendor.created_by,
                candidateCount
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

        // Set vendor_id to null for all candidates associated with this vendor
        await Candidate.updateMany({ vendor_id: id }, { $set: { vendor_id: null } });

        res.json({ message: "Vendor deleted successfully" });
    } catch (err) {
        next(err);
    }
});
export default router;