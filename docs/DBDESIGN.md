// ==========================================
// 1. GLOBAL SETTINGS & ENUMS
// ==========================================

Enum role_type {
  "0" // SUPER_ADMIN
  "1" // RECRUITER_ADMIN
  "2" // LEAD_RECRUITER
  "3" // RECRUITER 
}

Enum job_status {
  "0" // TRASH
  "1" // INACTIVE
  "2" // ONHOLD
  "3" // ACTIVE
}

Enum candidate_status {
  "0" // APPLIED
  "1" // WAITING (Email sent, slot pending)
  "2" // SCHEDULED (Slot picked)
  "3" // SELECTED
  "4" // REJECTED
  "5" // ON_HOLD
}

Enum interview_status {
  "0" // SCHEDULED
  "1" // COMPLETED_SELECTED
  "2" // COMPLETED_REJECTED
  "3" // NO_SHOW
  "4" // CANCELLED
  "5" // TECH_ISSUE
  "6" // PROXY_DETECTED
}

Enum slot_status {
  "0" // UNAVAILABLE
  "1" // AVAILABLE
  "2 " // BOOKED
}

// ==========================================
// 2. USER MANAGEMENT & HIERARCHY
// ==========================================

Table users {
  uid objectid [pk]
  username varchar [not null]
  email varchar [not null, unique]
  contact varchar 
  password_hash varchar
  
  // Hierarchy
  company_id objectid [ref: > company.id] 
  team_id objectid [ref: > teams.id] // Links user to a specific Region/Team
  
  role role_type [not null]
  is_active boolean [default: true]
  created_at timestamp [default: `now()`]
  updated_at timestamp
  created_by varchar [ref: > users.uid]
}

Table company {
  id objectid [pk]
  name varchar [not null]
  recruiter_admin_id objectid [unique, ref: - users.uid] // The main admin for this company
  subscription_status boolean [default: true]
  created_at timestamp
  updated_at timestamp
}

Table teams {
  id objectid [pk]
  company_id objectid [not null, ref: > company.id]
  region_name varchar [not null] // e.g., "North America", "APAC"
  lead_recruiter_id objectid [ref: - users.uid] // The Lead managing this team
  created_at timestamp
}

// ==========================================
// 3. COMPANY ASSETS (Clients, Vendors, Jobs)
// ==========================================

Table client {
  id objectid [pk]
  company_id objectid [not null, ref: > company.id] // Scoped to Recruiter Company
  name varchar [not null]
  email varchar [not null]
  contact varchar
  status boolean [default: true]
  created_by objectid [ref: > users.uid]
  created_at timestamp
}

Table vendor {
  id objectid [pk]
  company_id objectid [not null, ref: > company.id] // Scoped to Recruiter Company
  name varchar [not null]
  logo text
  status boolean [default: true]
  created_by objectid [ref: > users.uid]
  created_at timestamp
}

Table job {
  id objectid [pk]
  company_id objectid [not null, ref: > company.id]
   
  
  title varchar [not null]
  description text
  category varchar
  type varchar // Full-time, Contract
  location varchar
  experience_required integer
  
  status job_status [not null]
  required_skills array [note: "List of strings or ObjectIDs"]
  
  created_by objectid [ref: > users.uid]
  created_at timestamp
  updated_at timestamp
}

// ==========================================
// 4. GLOBAL RESOURCES (SuperAdmin Managed)
// ==========================================

Table interviewer {
  id objectid [pk]
  name varchar [not null]
  email varchar [not null]
  contact varchar
  logo text
  zoho_meet_uid varchar
  
  skills array // e.g. ["Java", "Python"]
  technologies array [note: "IDs from Technologies table"]
  
  created_by objectid [ref: > users.uid] // Usually SuperAdmin
  created_at timestamp
  updated_at timestamp
}

Table technologies {
  id objectid [pk]
  name varchar
  created_at timestamp
}

// ==========================================
// 5. INTERVIEW LIFECYCLE (The Core Logic)
// ==========================================

Table candidates {
  id objectid [pk]
  job_id objectid [not null, ref: > job.id]
  vendor_id objectid [ref: > vendor.id] // Optional: Candidate might not come from a vendor
  
  full_name varchar [not null]
  email varchar [not null]
  primary_contact varchar
  secondary_contact varchar
  experience_years float
  
  current_status candidate_status [not null, default: 0]
  
  profile_pic text
  resume_url text
  documents array
  
  created_at timestamp
  updated_at timestamp
}

// INVENTORY: Created by Admin/Interviewer
Table timeslots {
  id objectid [pk]
  interviewer_id objectid [not null, ref: > interviewer.id]
  date date [not null]
  start_time timestamp [not null]
  end_time timestamp [not null]
  status slot_status [not null] // 0=UNAVAILABLE, 1=AVAILABLE, 2=BOOKED
  
  created_by objectid
  created_at timestamp
}

// BOOKING: Created when Candidate selects a slot
// One Candidate can have MANY interviews (if rescheduled)
Table interview {
  id objectid [pk]
  candidate_id objectid [not null, ref: > candidates.id]
  timeslot_id objectid [unique, ref: - timeslots.id] // 1-to-1 with a slot
  
  meeting_link text
  status interview_status [default: 0] // Scheduled
  
  feedback_notes text
  recording_url text
  
  created_at timestamp
  updated_at timestamp
}

// ==========================================
// 6. RELATIONSHIPS (Extra visual links)
// ==========================================

Ref: interviewer.technologies > technologies.id
Ref: job.required_skills > technologies.id