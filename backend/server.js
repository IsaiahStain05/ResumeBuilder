import { v4 as uuid } from "uuid"
import express from "express"
import http from "node:http"
import bcrypt, { compareSync } from "bcrypt"
import cors from "cors"
import sqlite3 from "sqlite3"
import { GoogleGenAI } from "@google/genai"

const intPort = 3000
const app = express()
let objServer = null

app.use(express.json())
app.use(cors())

const dbResume = new sqlite3.Database("./db/Resume.db", (err) => {
    if (err) {
        console.error("Error opening database:", err)
    } else {
        console.log("Database connection successful!")
    }
})

// Database helpers keep the route code small while still using prepared statements.
const runQuery = (strQuery, arrParams = []) => {
    return new Promise((resolve, reject) => {
        dbResume.run(strQuery, arrParams, function (err) {
            if (err) {
                reject(err)
            } else {
                resolve(this)
            }
        })
    })
}

const allQuery = (strQuery, arrParams = []) => {
    return new Promise((resolve, reject) => {
        dbResume.all(strQuery, arrParams, (err, rows) => {
            if (err) {
                reject(err)
            } else {
                resolve(rows)
            }
        })
    })
}

const hashPassword = async (strPassword) => {
    return await bcrypt.hash(strPassword, 10)
}

const isBlank = (strValue) => {
    return typeof strValue !== "string" || strValue.trim() === ""
}

const cleanString = (strValue) => {
    return typeof strValue === "string" ? strValue.trim() : ""
}

const getApiKey = async (strUsername) => {
    const arrRows = await allQuery("SELECT apiKey FROM tblAPIKey WHERE userId = ?", [strUsername])
    return arrRows.length > 0 ? arrRows[0].apiKey : ""
}

const initializeDatabase = async () => {
    await runQuery("PRAGMA foreign_keys = ON")

    await runQuery(`CREATE TABLE IF NOT EXISTS tblJobs (
        jobId TEXT NOT NULL,
        userId TEXT NOT NULL,
        companyName TEXT NOT NULL,
        jobTitle TEXT NOT NULL,
        workPeriod TEXT NOT NULL,
        responsibilities TEXT NOT NULL,
        isSelected INTEGER NOT NULL DEFAULT 1,
        createdAt TEXT NOT NULL,
        PRIMARY KEY(jobId),
        FOREIGN KEY(userId) REFERENCES tblUser(username) ON DELETE CASCADE
    )`)

    await runQuery(`CREATE TABLE IF NOT EXISTS tblSkills (
        skillId TEXT NOT NULL,
        userId TEXT NOT NULL,
        skillName TEXT NOT NULL,
        skillCategory TEXT NOT NULL,
        skillDescription TEXT NOT NULL,
        isSelected INTEGER NOT NULL DEFAULT 1,
        createdAt TEXT NOT NULL,
        PRIMARY KEY(skillId),
        FOREIGN KEY(userId) REFERENCES tblUser(username) ON DELETE CASCADE
    )`)

    await runQuery(`CREATE TABLE IF NOT EXISTS tblEducation (
        educationId TEXT NOT NULL,
        userId TEXT NOT NULL,
        school TEXT NOT NULL,
        degree TEXT NOT NULL,
        graduationDate TEXT NOT NULL,
        gpa TEXT NOT NULL,
        details TEXT NOT NULL,
        isSelected INTEGER NOT NULL DEFAULT 1,
        createdAt TEXT NOT NULL,
        PRIMARY KEY(educationId),
        FOREIGN KEY(userId) REFERENCES tblUser(username) ON DELETE CASCADE
    )`)

    await runQuery(`CREATE TABLE IF NOT EXISTS tblResumes (
        resumeId TEXT NOT NULL,
        userId TEXT NOT NULL,
        resumeName TEXT NOT NULL,
        fullName TEXT NOT NULL,
        email TEXT NOT NULL,
        phone TEXT NOT NULL,
        linkedIn TEXT NOT NULL,
        website TEXT NOT NULL,
        objective TEXT NOT NULL,
        jobIds TEXT NOT NULL,
        skillIds TEXT NOT NULL,
        educationIds TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        PRIMARY KEY(resumeId),
        FOREIGN KEY(userId) REFERENCES tblUser(username) ON DELETE CASCADE
    )`)
}

process.on("uncaughtException", (err) => {
    console.error(err)
})

process.on("unhandledRejection", (err) => {
    console.error(err)
})

// User routes authenticate against tblUser and preserve the existing username primary key.
app.post("/api/user-login", async (req, res) => {
    try {
        let strUsername = cleanString(req.body.username)
        let strPassword = cleanString(req.body.password)

        if (isBlank(strUsername) || isBlank(strPassword)) {
            return res.status(400).json({outcome: "failure", message: "<p>Username and password are required.</p>"})
        }

        let arrRows = await allQuery("SELECT username, password FROM tblUser WHERE username = ?", [strUsername])

        if (arrRows.length == 1 && compareSync(strPassword, arrRows[0].password)) {
            return res.status(200).json({outcome: "success", message: "<p>Logged in!</p>", username: strUsername})
        } else if (arrRows.length == 1 && !compareSync(strPassword, arrRows[0].password)) {
            return res.status(401).json({outcome: "failure", message: "<p>Incorrect password!</p>"})
        } else if (arrRows.length == 0) {
            return res.status(404).json({outcome: "failure", message: "<p>No user by that name exists.</p>"})
        } else {
            return res.status(500).json({outcome: "failure", message: "<p>More than one user was found.</p>"})
        }
    } catch (err) {
        return res.status(500).json({outcome: "failure", message: `<p>${err.message}</p>`})
    }
})

app.post("/api/user-signup", async (req, res) => {
    try {
        let strUsername = cleanString(req.body.username)
        let strPassword = cleanString(req.body.password)

        if (isBlank(strUsername) || isBlank(strPassword)) {
            return res.status(400).json({outcome: "failure", message: "<p>Username and password are required.</p>"})
        }

        let arrRows = await allQuery("SELECT username, password FROM tblUser WHERE username = ?", [strUsername])

        if (arrRows.length == 1 && !compareSync(strPassword, arrRows[0].password)) {
            return res.status(401).json({outcome: "failure", message: "<p>An account already exists with that name.</p>"})
        } else if (arrRows.length == 1 && compareSync(strPassword, arrRows[0].password)) {
            return res.status(200).json({outcome: "success", message: "<p>Signed in!</p>", username: strUsername})
        } else if (arrRows.length > 1) {
            return res.status(500).json({outcome: "failure", message: "<p>More than one user was found.</p>"})
        }

        let strHashedPassword = await hashPassword(strPassword)
        await runQuery("INSERT INTO tblUser (username, password) VALUES (?, ?)", [strUsername, strHashedPassword])
        return res.status(201).json({outcome: "success", message: `<p>User created with username: ${strUsername}</p>`, username: strUsername})
    } catch (err) {
        return res.status(500).json({outcome: "failure", message: `<p>${err.message}</p>`})
    }
})

// Gemini key routes keep user-provided keys server-side for review requests.
app.get("/api/gemini-key", async (req, res) => {
    try {
        let strUsername = cleanString(req.query.username)

        if (isBlank(strUsername)) {
            return res.status(400).json([])
        }

        let arrRows = await allQuery("SELECT userId FROM tblAPIKey WHERE userId = ?", [strUsername])
        return res.status(200).json(arrRows.map(() => ({hasApiKey: true})))
    } catch (err) {
        return res.status(500).json([])
    }
})

app.put("/api/gemini-key", async (req, res) => {
    try {
        let strUsername = cleanString(req.body.username)
        let strApiKey = cleanString(req.body.apiKey)

        if (isBlank(strUsername) || isBlank(strApiKey)) {
            return res.status(400).json({outcome: "failure", message: "Username and Gemini API key are required."})
        }

        await runQuery("DELETE FROM tblAPIKey WHERE userId = ?", [strUsername])
        await runQuery("INSERT INTO tblAPIKey (apiKey, userId) VALUES (?, ?)", [strApiKey, strUsername])
        return res.status(200).json({outcome: "success", message: "Gemini API key saved."})
    } catch (err) {
        return res.status(500).json({outcome: "failure", message: err.message})
    }
})

app.delete("/api/gemini-key/:username", async (req, res) => {
    try {
        let strUsername = cleanString(req.params.username)

        if (isBlank(strUsername)) {
            return res.status(400).json({outcome: "failure", message: "Username is required."})
        }

        await runQuery("DELETE FROM tblAPIKey WHERE userId = ?", [strUsername])
        return res.status(200).json({outcome: "success", message: "Saved Gemini API key cleared."})
    } catch (err) {
        return res.status(500).json({outcome: "failure", message: err.message})
    }
})

// Job routes manage reusable work entries that can be toggled per resume draft.
app.get("/api/jobs", async (req, res) => {
    try {
        let strUsername = cleanString(req.query.username)

        if (isBlank(strUsername)) {
            return res.status(400).json([])
        }

        let arrRows = await allQuery("SELECT * FROM tblJobs WHERE userId = ? ORDER BY createdAt DESC", [strUsername])
        return res.status(200).json(arrRows)
    } catch (err) {
        return res.status(500).json([])
    }
})

app.post("/api/jobs", async (req, res) => {
    try {
        let strUsername = cleanString(req.body.username)
        let strCompanyName = cleanString(req.body.companyName)
        let strJobTitle = cleanString(req.body.jobTitle)
        let strWorkPeriod = cleanString(req.body.workPeriod)
        let strResponsibilities = cleanString(req.body.responsibilities)

        if (isBlank(strUsername) || isBlank(strCompanyName) || isBlank(strJobTitle) || isBlank(strWorkPeriod) || isBlank(strResponsibilities)) {
            return res.status(400).json({outcome: "failure", message: "Company, title, work period, and responsibilities are required."})
        }

        let strJobId = uuid()
        await runQuery("INSERT INTO tblJobs (jobId, userId, companyName, jobTitle, workPeriod, responsibilities, isSelected, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [strJobId, strUsername, strCompanyName, strJobTitle, strWorkPeriod, strResponsibilities, 1, new Date().toISOString()])
        return res.status(201).json({outcome: "success", message: "Work experience saved.", jobId: strJobId})
    } catch (err) {
        return res.status(500).json({outcome: "failure", message: err.message})
    }
})

app.put("/api/jobs/:jobId", async (req, res) => {
    try {
        let strJobId = cleanString(req.params.jobId)
        let strUsername = cleanString(req.body.username)
        let intIsSelected = req.body.isSelected ? 1 : 0

        if (isBlank(strJobId) || isBlank(strUsername)) {
            return res.status(400).json({outcome: "failure", message: "Job and username are required."})
        }

        let objResult = await runQuery("UPDATE tblJobs SET isSelected = ? WHERE jobId = ? AND userId = ?", [intIsSelected, strJobId, strUsername])
        return objResult.changes > 0 ? res.status(200).json({outcome: "success", message: "Work experience updated."}) : res.status(404).json({outcome: "failure", message: "Work experience not found."})
    } catch (err) {
        return res.status(500).json({outcome: "failure", message: err.message})
    }
})

app.delete("/api/jobs/:jobId", async (req, res) => {
    try {
        let strJobId = cleanString(req.params.jobId)
        let strUsername = cleanString(req.query.username)

        if (isBlank(strJobId) || isBlank(strUsername)) {
            return res.status(400).json({outcome: "failure", message: "Job and username are required."})
        }

        let objResult = await runQuery("DELETE FROM tblJobs WHERE jobId = ? AND userId = ?", [strJobId, strUsername])
        return objResult.changes > 0 ? res.status(200).json({outcome: "success", message: "Work experience removed."}) : res.status(404).json({outcome: "failure", message: "Work experience not found."})
    } catch (err) {
        return res.status(500).json({outcome: "failure", message: err.message})
    }
})

// Skill routes support categories so users can tailor technical or soft skill groups.
app.get("/api/skills", async (req, res) => {
    try {
        let strUsername = cleanString(req.query.username)

        if (isBlank(strUsername)) {
            return res.status(400).json([])
        }

        let arrRows = await allQuery("SELECT * FROM tblSkills WHERE userId = ? ORDER BY skillCategory, skillName", [strUsername])
        return res.status(200).json(arrRows)
    } catch (err) {
        return res.status(500).json([])
    }
})

app.post("/api/skills", async (req, res) => {
    try {
        let strUsername = cleanString(req.body.username)
        let strSkillName = cleanString(req.body.skillName)
        let strSkillCategory = cleanString(req.body.skillCategory)
        let strSkillDescription = cleanString(req.body.skillDescription)

        if (isBlank(strUsername) || isBlank(strSkillName)) {
            return res.status(400).json({outcome: "failure", message: "Skill name is required."})
        }

        let strSkillId = uuid()
        await runQuery("INSERT INTO tblSkills (skillId, userId, skillName, skillCategory, skillDescription, isSelected, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)", [strSkillId, strUsername, strSkillName, strSkillCategory || "General", strSkillDescription, 1, new Date().toISOString()])
        return res.status(201).json({outcome: "success", message: "Skill saved.", skillId: strSkillId})
    } catch (err) {
        return res.status(500).json({outcome: "failure", message: err.message})
    }
})

app.put("/api/skills/:skillId", async (req, res) => {
    try {
        let strSkillId = cleanString(req.params.skillId)
        let strUsername = cleanString(req.body.username)
        let intIsSelected = req.body.isSelected ? 1 : 0

        if (isBlank(strSkillId) || isBlank(strUsername)) {
            return res.status(400).json({outcome: "failure", message: "Skill and username are required."})
        }

        let objResult = await runQuery("UPDATE tblSkills SET isSelected = ? WHERE skillId = ? AND userId = ?", [intIsSelected, strSkillId, strUsername])
        return objResult.changes > 0 ? res.status(200).json({outcome: "success", message: "Skill updated."}) : res.status(404).json({outcome: "failure", message: "Skill not found."})
    } catch (err) {
        return res.status(500).json({outcome: "failure", message: err.message})
    }
})

app.delete("/api/skills/:skillId", async (req, res) => {
    try {
        let strSkillId = cleanString(req.params.skillId)
        let strUsername = cleanString(req.query.username)

        if (isBlank(strSkillId) || isBlank(strUsername)) {
            return res.status(400).json({outcome: "failure", message: "Skill and username are required."})
        }

        let objResult = await runQuery("DELETE FROM tblSkills WHERE skillId = ? AND userId = ?", [strSkillId, strUsername])
        return objResult.changes > 0 ? res.status(200).json({outcome: "success", message: "Skill removed."}) : res.status(404).json({outcome: "failure", message: "Skill not found."})
    } catch (err) {
        return res.status(500).json({outcome: "failure", message: err.message})
    }
})

// Education routes mirror the resume section and keep selection separate from deletion.
app.get("/api/education", async (req, res) => {
    try {
        let strUsername = cleanString(req.query.username)

        if (isBlank(strUsername)) {
            return res.status(400).json([])
        }

        let arrRows = await allQuery("SELECT * FROM tblEducation WHERE userId = ? ORDER BY createdAt DESC", [strUsername])
        return res.status(200).json(arrRows)
    } catch (err) {
        return res.status(500).json([])
    }
})

app.post("/api/education", async (req, res) => {
    try {
        let strUsername = cleanString(req.body.username)
        let strSchool = cleanString(req.body.school)
        let strDegree = cleanString(req.body.degree)
        let strGraduationDate = cleanString(req.body.graduationDate)
        let strGpa = cleanString(req.body.gpa)
        let strDetails = cleanString(req.body.details)

        if (isBlank(strUsername) || isBlank(strSchool) || isBlank(strDegree) || isBlank(strGraduationDate)) {
            return res.status(400).json({outcome: "failure", message: "School, degree, and graduation date are required."})
        }

        let strEducationId = uuid()
        await runQuery("INSERT INTO tblEducation (educationId, userId, school, degree, graduationDate, gpa, details, isSelected, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", [strEducationId, strUsername, strSchool, strDegree, strGraduationDate, strGpa, strDetails, 1, new Date().toISOString()])
        return res.status(201).json({outcome: "success", message: "Education saved.", educationId: strEducationId})
    } catch (err) {
        return res.status(500).json({outcome: "failure", message: err.message})
    }
})

app.put("/api/education/:educationId", async (req, res) => {
    try {
        let strEducationId = cleanString(req.params.educationId)
        let strUsername = cleanString(req.body.username)
        let intIsSelected = req.body.isSelected ? 1 : 0

        if (isBlank(strEducationId) || isBlank(strUsername)) {
            return res.status(400).json({outcome: "failure", message: "Education and username are required."})
        }

        let objResult = await runQuery("UPDATE tblEducation SET isSelected = ? WHERE educationId = ? AND userId = ?", [intIsSelected, strEducationId, strUsername])
        return objResult.changes > 0 ? res.status(200).json({outcome: "success", message: "Education updated."}) : res.status(404).json({outcome: "failure", message: "Education not found."})
    } catch (err) {
        return res.status(500).json({outcome: "failure", message: err.message})
    }
})

app.delete("/api/education/:educationId", async (req, res) => {
    try {
        let strEducationId = cleanString(req.params.educationId)
        let strUsername = cleanString(req.query.username)

        if (isBlank(strEducationId) || isBlank(strUsername)) {
            return res.status(400).json({outcome: "failure", message: "Education and username are required."})
        }

        let objResult = await runQuery("DELETE FROM tblEducation WHERE educationId = ? AND userId = ?", [strEducationId, strUsername])
        return objResult.changes > 0 ? res.status(200).json({outcome: "success", message: "Education removed."}) : res.status(404).json({outcome: "failure", message: "Education not found."})
    } catch (err) {
        return res.status(500).json({outcome: "failure", message: err.message})
    }
})

// Resume routes save full resume drafts and selected reusable entries per user.
app.get("/api/resumes", async (req, res) => {
    try {
        let strUsername = cleanString(req.query.username)

        if (isBlank(strUsername)) {
            return res.status(400).json([])
        }

        let arrRows = await allQuery("SELECT * FROM tblResumes WHERE userId = ? ORDER BY updatedAt DESC", [strUsername])
        return res.status(200).json(arrRows)
    } catch (err) {
        return res.status(500).json([])
    }
})

app.post("/api/resumes", async (req, res) => {
    try {
        let strUsername = cleanString(req.body.username)
        let strResumeName = cleanString(req.body.resumeName)
        let strFullName = cleanString(req.body.fullName)
        let strEmail = cleanString(req.body.email)
        let strPhone = cleanString(req.body.phone)
        let strLinkedIn = cleanString(req.body.linkedIn)
        let strWebsite = cleanString(req.body.website)
        let strObjective = cleanString(req.body.objective)
        let arrJobIds = Array.isArray(req.body.jobIds) ? req.body.jobIds : []
        let arrSkillIds = Array.isArray(req.body.skillIds) ? req.body.skillIds : []
        let arrEducationIds = Array.isArray(req.body.educationIds) ? req.body.educationIds : []

        if (isBlank(strUsername) || isBlank(strResumeName)) {
            return res.status(400).json({outcome: "failure", message: "Username and resume name are required."})
        }

        let strResumeId = uuid()
        let strNow = new Date().toISOString()
        await runQuery("INSERT INTO tblResumes (resumeId, userId, resumeName, fullName, email, phone, linkedIn, website, objective, jobIds, skillIds, educationIds, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [
            strResumeId,
            strUsername,
            strResumeName,
            strFullName,
            strEmail,
            strPhone,
            strLinkedIn,
            strWebsite,
            strObjective,
            JSON.stringify(arrJobIds),
            JSON.stringify(arrSkillIds),
            JSON.stringify(arrEducationIds),
            strNow,
            strNow
        ])

        return res.status(201).json({outcome: "success", message: "Resume saved.", resumeId: strResumeId, updatedAt: strNow})
    } catch (err) {
        return res.status(500).json({outcome: "failure", message: err.message})
    }
})

app.put("/api/resumes/:resumeId", async (req, res) => {
    try {
        let strResumeId = cleanString(req.params.resumeId)
        let strUsername = cleanString(req.body.username)
        let strResumeName = cleanString(req.body.resumeName)
        let strFullName = cleanString(req.body.fullName)
        let strEmail = cleanString(req.body.email)
        let strPhone = cleanString(req.body.phone)
        let strLinkedIn = cleanString(req.body.linkedIn)
        let strWebsite = cleanString(req.body.website)
        let strObjective = cleanString(req.body.objective)
        let arrJobIds = Array.isArray(req.body.jobIds) ? req.body.jobIds : []
        let arrSkillIds = Array.isArray(req.body.skillIds) ? req.body.skillIds : []
        let arrEducationIds = Array.isArray(req.body.educationIds) ? req.body.educationIds : []

        if (isBlank(strResumeId) || isBlank(strUsername) || isBlank(strResumeName)) {
            return res.status(400).json({outcome: "failure", message: "Resume, username, and resume name are required."})
        }

        let strNow = new Date().toISOString()
        let objResult = await runQuery("UPDATE tblResumes SET resumeName = ?, fullName = ?, email = ?, phone = ?, linkedIn = ?, website = ?, objective = ?, jobIds = ?, skillIds = ?, educationIds = ?, updatedAt = ? WHERE resumeId = ? AND userId = ?", [
            strResumeName,
            strFullName,
            strEmail,
            strPhone,
            strLinkedIn,
            strWebsite,
            strObjective,
            JSON.stringify(arrJobIds),
            JSON.stringify(arrSkillIds),
            JSON.stringify(arrEducationIds),
            strNow,
            strResumeId,
            strUsername
        ])

        return objResult.changes > 0 ? res.status(200).json({outcome: "success", message: "Resume updated.", resumeId: strResumeId, updatedAt: strNow}) : res.status(404).json({outcome: "failure", message: "Resume not found."})
    } catch (err) {
        return res.status(500).json({outcome: "failure", message: err.message})
    }
})

// Gemini review gives short resume-editing suggestions after a user saves details.
app.post("/api/resume-review", async (req, res) => {
    try {
        let strUsername = cleanString(req.body.username)
        let strSectionType = cleanString(req.body.sectionType)
        let strContent = cleanString(req.body.content)

        if (isBlank(strUsername) || isBlank(strSectionType) || isBlank(strContent)) {
            return res.status(400).json({outcome: "failure", message: "Username, section type, and content are required."})
        }

        let strApiKey = await getApiKey(strUsername)

        if (isBlank(strApiKey)) {
            return res.status(404).json({outcome: "failure", message: "Save a Gemini API key before requesting AI suggestions."})
        }

        const aiGemini = new GoogleGenAI({apiKey: strApiKey})
        const objResponse = await aiGemini.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: `Review this resume ${strSectionType} entry and suggest concise improvements. Focus on action verbs, measurable impact, clarity, and professional wording. Return no more than five short bullet points.\n\n${strContent}`
        })

        return res.status(200).json({outcome: "success", suggestions: objResponse.text})
    } catch (err) {
        let intStatus = Number(err.status || err.code || err.response?.status)
        let strMessage = err.message || "Gemini request failed."

        if (intStatus == 429 || strMessage.toLowerCase().includes("too many requests") || strMessage.toLowerCase().includes("quota")) {
            return res.status(429).json({
                outcome: "failure",
                message: "Gemini is rate limiting this API key right now. Wait a minute before trying again, or save a different Gemini key."
            })
        }

        if (intStatus == 400 || intStatus == 401 || intStatus == 403 || strMessage.toLowerCase().includes("api key")) {
            return res.status(401).json({
                outcome: "failure",
                message: "Gemini rejected the saved API key. Clear it and save a valid key before reviewing again."
            })
        }

        return res.status(500).json({outcome: "failure", message: strMessage})
    }
})

try {
    await initializeDatabase()
    objServer = http.createServer(app)
    objServer.listen(intPort, () => {
        console.log("App listening on", intPort)
    })
    objServer.keepAliveTimeout = 65000
} catch (err) {
    console.error("Database initialization failed:", err)
}
