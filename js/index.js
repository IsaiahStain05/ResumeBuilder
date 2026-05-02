const strBaseUrl = "http://localhost:3000/api"

async function exportResumeToDocx() {
    const resume = getResumeData()

    const children = []

    children.push(
        new Paragraph({
            children: [
                new TextRun({
                    text: resume.name,
                    bold: true,
                    size: 32
                })
            ]
        })
    )

    if (resume.contact.length) {
        children.push(
            new Paragraph({
                text: resume.contact.join(" | ")
            })
        )
    }

    if (resume.objective) {
        children.push(
            new Paragraph({
                text: "Objective",
                heading: HeadingLevel.HEADING_1
            }),
            new Paragraph(resume.objective)
        )
    }

    if (resume.education.length) {
        children.push(
            new Paragraph({
                text: "Education",
                heading: HeadingLevel.HEADING_1
            })
        )

        resume.education.forEach(edu => {
            let line1 = `${edu.school} | ${edu.degree}`
            let line2 = edu.graduationDate
            if (edu.gpa) line2 += ` | GPA: ${edu.gpa}`

            children.push(
                new Paragraph({
                    children: [new TextRun({ text: line1, bold: true })]
                }),
                new Paragraph(line2)
            )

            if (edu.details) {
                children.push(new Paragraph(edu.details))
            }
        })
    }

    if (resume.jobs.length) {
        children.push(
            new Paragraph({
                text: "Work Experience",
                heading: HeadingLevel.HEADING_1
            })
        )

        resume.jobs.forEach(job => {
            children.push(
                new Paragraph({
                    children: [
                        new TextRun({
                            text: `${job.jobTitle} | ${job.companyName}`,
                            bold: true
                        })
                    ]
                }),
                new Paragraph(job.workPeriod)
            )

            job.responsibilities.forEach(line => {
                if (line.trim()) {
                    children.push(
                        new Paragraph({
                            text: line,
                            bullet: {
                                level: 0
                            }
                        })
                    )
                }
            })
        })
    }

    if (resume.skills.length) {
        children.push(
            new Paragraph({
                text: "Skills",
                heading: HeadingLevel.HEADING_1
            })
        )

        resume.skills.forEach(skill => {
            let line = `${skill.skillCategory}: ${skill.skillName}`
            if (skill.skillDescription) {
                line += ` (${skill.skillDescription})`
            }

            children.push(
                new Paragraph({
                    text: line,
                    bullet: {
                        level: 0
                    }
                })
            )
        })
    }

    const doc = new Document({
        sections: [
            {
                children
            }
        ]
    })

    const buffer = await Packer.toBuffer(doc)
    fs.writeFileSync("resume.docx", buffer)
}

let arrJobs = []
let arrSkills = []
let arrEducation = []
let arrResumes = []
let blnHasGeminiKey = false
let blnGeminiBusy = false
let strCurrentResumeId = ""

// Session helpers decide whether the login screen or resume editor should be visible.
const getUsername = () => {
    return sessionStorage.getItem("username") || ""
}

const showHomePage = async () => {
    document.querySelector("#loginPage").classList.add("d-none")
    document.querySelector("#homePage").classList.remove("d-none")
    clearResumeDraftFields()
    restoreResumeDraft()
    await loadResumeData()
    await loadResumes()
    await loadGeminiStatus()
}

const showLoginPage = () => {
    document.querySelector("#homePage").classList.add("d-none")
    document.querySelector("#loginPage").classList.remove("d-none")
}

const showAlert = async (strTitle, strMessage, strIcon) => {
    return await Swal.fire({
        title: strTitle,
        html: strMessage,
        icon: strIcon
    })
}

// Shared fetch wrapper keeps status handling consistent across every API call.
const getJson = async (strUrl, objOptions = {}) => {
    const objResponse = await fetch(strUrl, objOptions)
    const objData = await objResponse.json()

    if (!objResponse.ok && !Array.isArray(objData)) {
        throw new Error(objData.message || "Request failed.")
    }

    return objData
}

// User-entered resume details are escaped before being rendered back into the page.
const escapeHtml = (strValue) => {
    const divElement = document.createElement("div")
    divElement.textContent = strValue || ""
    return divElement.innerHTML
}

const getPlainText = (strSelector) => {
    return document.querySelector(strSelector).value.trim()
}

const splitResumeLines = (strValue) => {
    return strValue.split(/\r?\n|;/).map((strLine) => strLine.trim()).filter((strLine) => strLine != "")
}

const getJsonArray = (strValue) => {
    try {
        const arrValue = JSON.parse(strValue || "[]")
        return Array.isArray(arrValue) ? arrValue : []
    } catch (err) {
        return []
    }
}

const arrDraftFieldSelectors = ["#strResumeName", "#strFullName", "#strEmail", "#strPhone", "#strLinkedIn", "#strWebsite", "#strDescription"]

const getDraftStorageKey = () => {
    return `resumeDraft_${getUsername()}`
}

const getDraftValues = () => {
    return {
        resumeName: getPlainText("#strResumeName"),
        fullName: getPlainText("#strFullName"),
        email: getPlainText("#strEmail"),
        phone: getPlainText("#strPhone"),
        linkedIn: getPlainText("#strLinkedIn"),
        website: getPlainText("#strWebsite"),
        objective: getPlainText("#strDescription")
    }
}

const persistResumeDraft = () => {
    if (getUsername() == "") {
        return
    }

    sessionStorage.setItem(getDraftStorageKey(), JSON.stringify(getDraftValues()))
}

const clearResumeDraftFields = () => {
    arrDraftFieldSelectors.forEach((strSelector) => {
        document.querySelector(strSelector).value = ""
    })
    strCurrentResumeId = ""
}

const restoreResumeDraft = () => {
    const strDraft = sessionStorage.getItem(getDraftStorageKey())

    if (!strDraft) {
        return
    }

    try {
        const objDraft = JSON.parse(strDraft)
        setInputValue("#strResumeName", objDraft.resumeName)
        setInputValue("#strFullName", objDraft.fullName)
        setInputValue("#strEmail", objDraft.email)
        setInputValue("#strPhone", objDraft.phone)
        setInputValue("#strLinkedIn", objDraft.linkedIn)
        setInputValue("#strWebsite", objDraft.website)
        setInputValue("#strDescription", objDraft.objective)
    } catch (err) {
        sessionStorage.removeItem(getDraftStorageKey())
    }
}

const clearResumeDraftStorage = () => {
    if (getUsername() != "") {
        sessionStorage.removeItem(getDraftStorageKey())
    }
}

// Login validation happens in the browser first so users get immediate feedback.
const validateLogin = () => {
    const strUsername = document.querySelector("#txtUser").value.trim()
    const strPassword = document.querySelector("#txtPassword").value.trim()
    let strErrHtml = ""

    if (strUsername == "") {
        strErrHtml += "<div>Username cannot be empty.</div>"
    }

    if (strPassword == "") {
        strErrHtml += "<div>Password cannot be empty.</div>"
    }

    return {strUsername, strPassword, strErrHtml}
}

// Resume entries are reviewed with Gemini only after they have been saved.
const requestAiReview = async (strSectionType, strContent) => {
    try {
        if (!blnHasGeminiKey) {
            document.querySelector("#aiSuggestions").textContent = "Save a Gemini API key before requesting AI suggestions."
            return
        }

        if (blnGeminiBusy) {
            document.querySelector("#aiSuggestions").textContent = "Gemini is already reviewing. Please wait for the current request to finish."
            return
        }

        blnGeminiBusy = true
        updateGeminiStatus()
        document.querySelector("#aiSuggestions").innerHTML = `<div class="text-info">Gemini is reviewing your ${escapeHtml(strSectionType)}...</div>`

        const objResult = await getJson(`${strBaseUrl}/resume-review`, {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({
                username: getUsername(),
                sectionType: strSectionType,
                content: strContent
            })
        })

        document.querySelector("#aiSuggestions").innerHTML = `<div>${escapeHtml(objResult.suggestions).replaceAll("\n", "<br>")}</div>`
    } catch (err) {
        document.querySelector("#aiSuggestions").textContent = err.message
    } finally {
        blnGeminiBusy = false
        updateGeminiStatus()
    }
}

const updateGeminiStatus = () => {
    const spanGeminiStatus = document.querySelector("#geminiStatus")
    const btnReviewObjective = document.querySelector("#btnReviewObjective")
    const btnReviewResume = document.querySelector("#btnReviewResume")

    if (blnHasGeminiKey) {
        spanGeminiStatus.className = "badge text-bg-success"
        spanGeminiStatus.textContent = "Gemini connected"
        btnReviewObjective.disabled = blnGeminiBusy
        btnReviewResume.disabled = blnGeminiBusy
    } else {
        spanGeminiStatus.className = "badge text-bg-secondary"
        spanGeminiStatus.textContent = "Gemini not connected"
        btnReviewObjective.disabled = true
        btnReviewResume.disabled = true
    }
}

const loadGeminiStatus = async () => {
    try {
        const arrRows = await getJson(`${strBaseUrl}/gemini-key?username=${encodeURIComponent(getUsername())}`)
        blnHasGeminiKey = arrRows.length > 0 && arrRows[0].hasApiKey
    } catch (err) {
        blnHasGeminiKey = false
    }

    updateGeminiStatus()
}

// Account-scoped resume data is loaded through query strings per the project API rules.
const loadResumeData = async () => {
    const strUsername = getUsername()

    if (strUsername == "") {
        showLoginPage()
        return
    }

    arrJobs = await getJson(`${strBaseUrl}/jobs?username=${encodeURIComponent(strUsername)}`)
    arrSkills = await getJson(`${strBaseUrl}/skills?username=${encodeURIComponent(strUsername)}`)
    arrEducation = await getJson(`${strBaseUrl}/education?username=${encodeURIComponent(strUsername)}`)
    renderResumeLists()
}

const loadResumes = async () => {
    arrResumes = await getJson(`${strBaseUrl}/resumes?username=${encodeURIComponent(getUsername())}`)
    renderResumeDropdown()
}

const renderResumeDropdown = () => {
    const selectSavedResume = document.querySelector("#savedResumeSelect")
    const strSelectedResumeId = strCurrentResumeId

    selectSavedResume.innerHTML = `<option value="">Select a saved resume</option>${arrResumes.map((objResume) => {
        return `<option value="${objResume.resumeId}">${escapeHtml(objResume.resumeName)}</option>`
    }).join("")}`

    selectSavedResume.value = strSelectedResumeId
}

// Render helpers keep the page styled like a resume while still allowing item selection.
const renderResumeLists = () => {
    renderJobs()
    renderSkills()
    renderEducation()
}

const appendListHtml = (strSelector, strHtml) => {
    const divList = document.querySelector(strSelector)

    if (divList.querySelector("[data-empty-message='true']")) {
        divList.innerHTML = ""
    }

    divList.insertAdjacentHTML("beforeend", strHtml)
}

const removeListHtml = (strSelector, strId, strEmptyMessage) => {
    const divList = document.querySelector(strSelector)
    const articleEntry = divList.querySelector(`[data-entry-id="${strId}"]`)

    if (articleEntry) {
        articleEntry.remove()
    }

    if (divList.children.length == 0) {
        divList.innerHTML = `<p data-empty-message="true">${strEmptyMessage}</p>`
    }
}

const getJobHtml = (objJob) => {
    const strCheckboxId = `job-${objJob.jobId}`

    return `<article class="border-top pt-2 mt-2" data-entry-id="${objJob.jobId}">
        <div class="d-flex justify-content-between gap-2">
            <div>
                <strong>${escapeHtml(objJob.companyName)}</strong> - ${escapeHtml(objJob.jobTitle)}
                <div>${escapeHtml(objJob.workPeriod)}</div>
            </div>
            <div class="d-flex gap-2 align-items-start flex-shrink-0">
                <input id="${strCheckboxId}" class="btn-check resume-select" type="checkbox" data-section="jobs" data-id="${objJob.jobId}" aria-label="Include ${escapeHtml(objJob.companyName)} on resume" ${objJob.isSelected ? "checked" : ""}>
                <label class="btn btn-outline-secondary btn-sm" for="${strCheckboxId}">Include</label>
                <button type="button" class="btn btn-outline-danger btn-sm delete-entry" data-section="jobs" data-id="${objJob.jobId}">Remove</button>
            </div>
        </div>
        <p class="mb-0">${escapeHtml(objJob.responsibilities)}</p>
    </article>`
}

const renderJobs = () => {
    const divJobsList = document.querySelector("#jobsList")

    if (arrJobs.length == 0) {
        divJobsList.innerHTML = "<p data-empty-message='true'>No work experience has been saved yet.</p>"
        return
    }

    divJobsList.innerHTML = arrJobs.map((objJob) => getJobHtml(objJob)).join("")
}

const getSkillHtml = (objSkill) => {
    const strDescription = objSkill.skillDescription ? ` - ${escapeHtml(objSkill.skillDescription)}` : ""
    const strCheckboxId = `skill-${objSkill.skillId}`

    return `<article class="border-top pt-2 mt-2" data-entry-id="${objSkill.skillId}">
        <div class="d-flex justify-content-between gap-2">
            <div><strong>${escapeHtml(objSkill.skillCategory)}</strong>: ${escapeHtml(objSkill.skillName)}${strDescription}</div>
            <div class="d-flex gap-2 align-items-start flex-shrink-0">
                <input id="${strCheckboxId}" class="btn-check resume-select" type="checkbox" data-section="skills" data-id="${objSkill.skillId}" aria-label="Include ${escapeHtml(objSkill.skillName)} on resume" ${objSkill.isSelected ? "checked" : ""}>
                <label class="btn btn-outline-secondary btn-sm" for="${strCheckboxId}">Include</label>
                <button type="button" class="btn btn-outline-danger btn-sm delete-entry" data-section="skills" data-id="${objSkill.skillId}">Remove</button>
            </div>
        </div>
    </article>`
}

const renderSkills = () => {
    const divSkillsList = document.querySelector("#skillsList")

    if (arrSkills.length == 0) {
        divSkillsList.innerHTML = "<p data-empty-message='true'>No skills have been saved yet.</p>"
        return
    }

    divSkillsList.innerHTML = arrSkills.map((objSkill) => getSkillHtml(objSkill)).join("")
}

const getEducationHtml = (objEducation) => {
    const strGpa = objEducation.gpa ? ` | GPA: ${escapeHtml(objEducation.gpa)}` : ""
    const strDetails = objEducation.details ? `<p class="mb-0">${escapeHtml(objEducation.details)}</p>` : ""
    const strCheckboxId = `education-${objEducation.educationId}`

    return `<article class="border-top pt-2 mt-2" data-entry-id="${objEducation.educationId}">
        <div class="d-flex justify-content-between gap-2">
            <div>
                <strong>${escapeHtml(objEducation.school)}</strong> - ${escapeHtml(objEducation.degree)}
                <div>${escapeHtml(objEducation.graduationDate)}${strGpa}</div>
            </div>
            <div class="d-flex gap-2 align-items-start flex-shrink-0">
                <input id="${strCheckboxId}" class="btn-check resume-select" type="checkbox" data-section="education" data-id="${objEducation.educationId}" aria-label="Include ${escapeHtml(objEducation.school)} on resume" ${objEducation.isSelected ? "checked" : ""}>
                <label class="btn btn-outline-secondary btn-sm" for="${strCheckboxId}">Include</label>
                <button type="button" class="btn btn-outline-danger btn-sm delete-entry" data-section="education" data-id="${objEducation.educationId}">Remove</button>
            </div>
        </div>
        ${strDetails}
    </article>`
}

const renderEducation = () => {
    const divEducationList = document.querySelector("#educationList")

    if (arrEducation.length == 0) {
        divEducationList.innerHTML = "<p data-empty-message='true'>No education has been saved yet.</p>"
        return
    }

    divEducationList.innerHTML = arrEducation.map((objEducation) => getEducationHtml(objEducation)).join("")
}

// Form reset helpers prepare each section for the next reusable resume item.
const clearEducationForm = () => {
    document.querySelector("#strSchool").value = ""
    document.querySelector("#strGradDate").value = ""
    document.querySelector("#strDegree").value = ""
    document.querySelector("#strGPA").value = ""
    document.querySelector("#strEducationDetails").value = ""
}

const clearJobForm = () => {
    document.querySelector("#strWorkplace").value = ""
    document.querySelector("#strJobTitle").value = ""
    document.querySelector("#strWorkTime").value = ""
    document.querySelector("#strJobDesc").value = ""
}

const clearSkillForm = () => {
    document.querySelector("#strSkill").value = ""
    document.querySelector("#strSkillCategory").value = ""
    document.querySelector("#strSkillDescription").value = ""
}

const getSelectedIds = (arrItems, strIdField) => {
    return arrItems.filter((objItem) => objItem.isSelected).map((objItem) => objItem[strIdField])
}

const getResumePayload = () => {
    return {
        username: getUsername(),
        resumeName: getPlainText("#strResumeName"),
        fullName: getPlainText("#strFullName"),
        email: getPlainText("#strEmail"),
        phone: getPlainText("#strPhone"),
        linkedIn: getPlainText("#strLinkedIn"),
        website: getPlainText("#strWebsite"),
        objective: getPlainText("#strDescription"),
        jobIds: getSelectedIds(arrJobs, "jobId"),
        skillIds: getSelectedIds(arrSkills, "skillId"),
        educationIds: getSelectedIds(arrEducation, "educationId")
    }
}

function getResumeData() {
    const arrSelectedEducation = arrEducation.filter(objEducation => objEducation.isSelected)
    const arrSelectedJobs = arrJobs.filter(objJob => objJob.isSelected)
    const arrSelectedSkills = arrSkills.filter(objSkill => objSkill.isSelected)

    // Group skills by category for cleaner display
    // e.g. "Languages: JavaScript, Python, C++"
    const objSkillsByCategory = {}
    arrSelectedSkills.forEach(objSkill => {
        const strCategory = objSkill.skillCategory || "Other"
        if (!objSkillsByCategory[strCategory]) {
            objSkillsByCategory[strCategory] = []
        }
        const strSkill = objSkill.skillDescription
            ? `${objSkill.skillName} (${objSkill.skillDescription})`
            : objSkill.skillName
        if (strSkill.trim()) {
            objSkillsByCategory[strCategory].push(strSkill.trim())
        }
    })

    // Convert grouped skills into array of { category, items }
    const arrGroupedSkills = Object.entries(objSkillsByCategory).map(([strCategory, arrItems]) => ({
        category: strCategory,
        items: arrItems,
        // "Languages: JavaScript, Python, C++"
        summary: `${strCategory}: ${arrItems.join(", ")}`
    }))

    // Build contact lines with labels for Word/PDF
    const arrContactDetails = [
        { label: "Email",    value: getPlainText("#strEmail") },
        { label: "Phone",    value: getPlainText("#strPhone") },
        { label: "LinkedIn", value: getPlainText("#strLinkedIn") },
        { label: "Website",  value: getPlainText("#strWebsite") }
    ].filter(objContact => objContact.value.trim() !== "")

    return {
        // Header
        name: getPlainText("#strFullName"),

        // Contact — both formats for flexibility
        contact: arrContactDetails.map(objContact => objContact.value),
        contactDetailed: arrContactDetails,
        contactLine: arrContactDetails.map(objContact => objContact.value).join("  |  "),

        // Objective / Summary
        objective: getPlainText("#strDescription").trim(),

        // Education — sorted by graduation date (newest first)
        education: arrSelectedEducation
            .map(objEducation => ({
                school: (objEducation.school || "").trim(),
                degree: (objEducation.degree || "").trim(),
                graduationDate: (objEducation.graduationDate || "").trim(),
                gpa: (objEducation.gpa || "").trim(),
                details: (objEducation.details || "").trim(),
                // "BS Computer Science — University of Tech"
                headline: [objEducation.degree, objEducation.school]
                    .filter(Boolean)
                    .join(" — "),
                // "2019 | GPA: 3.8"
                subline: [
                    objEducation.graduationDate,
                    objEducation.gpa ? `GPA: ${objEducation.gpa}` : ""
                ].filter(Boolean).join("  |  ")
            }))
            .sort((a, b) => {
                // Newest graduation first
                const numA = parseInt(a.graduationDate) || 0
                const numB = parseInt(b.graduationDate) || 0
                return numB - numA
            }),

        // Work Experience — sorted by work period (newest first)
        jobs: arrSelectedJobs
            .map(objJob => {
                // Split responsibilities and clean them
                const arrLines = splitResumeLines(objJob.responsibilities || "")
                    .map(strLine => strLine.trim())
                    .filter(strLine => strLine !== "")

                return {
                    jobTitle: (objJob.jobTitle || "").trim(),
                    companyName: (objJob.companyName || "").trim(),
                    workPeriod: (objJob.workPeriod || "").trim(),
                    responsibilities: arrLines,
                    // "Software Engineer — ABC Corp"
                    headline: [objJob.jobTitle, objJob.companyName]
                        .filter(Boolean)
                        .join(" — "),
                    hasResponsibilities: arrLines.length > 0
                }
            })
            .sort((a, b) => {
                // Try to sort by end year (newest first)
                const numA = parseInt(a.workPeriod.split(/[-–]/g).pop()) || 0
                const numB = parseInt(b.workPeriod.split(/[-–]/g).pop()) || 0
                return numB - numA
            }),

        // Skills — both flat and grouped
        skills: arrSelectedSkills.map(objSkill => ({
            skillCategory: (objSkill.skillCategory || "").trim(),
            skillName: (objSkill.skillName || "").trim(),
            skillDescription: (objSkill.skillDescription || "").trim()
        })),
        skillsGrouped: arrGroupedSkills,

        // Metadata for export formatting
        hasSections: {
            objective: getPlainText("#strDescription").trim() !== "",
            education: arrSelectedEducation.length > 0,
            jobs: arrSelectedJobs.length > 0,
            skills: arrSelectedSkills.length > 0
        }
    }
}

async function exportToDocx() {
    try {
        const resumeData = getResumeData()
        
        // Check if we have any data
        if (!resumeData.education.length && !resumeData.jobs.length && !resumeData.skills.length) {
            alert('Please add some content to your resume before exporting.')
            return
        }

        // Show loading/status
        const exportBtn = document.getElementById('btnPrintToDoc')
        const originalText = exportBtn.textContent
        exportBtn.textContent = 'Exporting...'
        exportBtn.disabled = true

        // Call Electron main process
        const result = await window.electronAPI.exportDocx(resumeData)
        
        // Restore button
        exportBtn.textContent = originalText
        exportBtn.disabled = false

        // Show result
        if (result.success) {
            alert(`✅ ${result.message}\nFile saved to: ${result.filePath}`)
        } else {
            alert(`❌ ${result.message}`)
        }
        
    } catch (error) {
        console.error('Export error:', error)
        alert(`Export failed: ${error.message}`)
    }
}

const setInputValue = (strSelector, strValue) => {
    document.querySelector(strSelector).value = strValue || ""
}

const applySelectedIds = (arrIds, strSection, strIdField) => {
    const setIds = new Set(arrIds)
    const arrTarget = strSection == "jobs" ? arrJobs : strSection == "skills" ? arrSkills : arrEducation

    arrTarget.forEach((objItem) => {
        objItem.isSelected = setIds.has(objItem[strIdField]) ? 1 : 0
    })

    document.querySelectorAll(`.resume-select[data-section="${strSection}"]`).forEach((inputCheckbox) => {
        inputCheckbox.checked = setIds.has(inputCheckbox.dataset.id)
    })
}

const applyResume = (objResume) => {
    strCurrentResumeId = objResume.resumeId
    setInputValue("#strResumeName", objResume.resumeName)
    setInputValue("#strFullName", objResume.fullName)
    setInputValue("#strEmail", objResume.email)
    setInputValue("#strPhone", objResume.phone)
    setInputValue("#strLinkedIn", objResume.linkedIn)
    setInputValue("#strWebsite", objResume.website)
    setInputValue("#strDescription", objResume.objective)
    applySelectedIds(getJsonArray(objResume.jobIds), "jobs", "jobId")
    applySelectedIds(getJsonArray(objResume.skillIds), "skills", "skillId")
    applySelectedIds(getJsonArray(objResume.educationIds), "education", "educationId")
    document.querySelector("#savedResumeSelect").value = strCurrentResumeId
    persistResumeDraft()
}

const getSelectedResumeContent = () => {
    const arrSelectedEducation = arrEducation.filter((objEducation) => objEducation.isSelected)
    const arrSelectedJobs = arrJobs.filter((objJob) => objJob.isSelected)
    const arrSelectedSkills = arrSkills.filter((objSkill) => objSkill.isSelected)

    return [
        `Name: ${getPlainText("#strFullName")}`,
        `Contact: ${getPlainText("#strEmail")} ${getPlainText("#strPhone")} ${getPlainText("#strLinkedIn")} ${getPlainText("#strWebsite")}`,
        `Objective: ${getPlainText("#strDescription")}`,
        `Education: ${arrSelectedEducation.map((objEducation) => `${objEducation.school}, ${objEducation.degree}, ${objEducation.graduationDate}. ${objEducation.details}`).join(" | ")}`,
        `Work: ${arrSelectedJobs.map((objJob) => `${objJob.companyName}, ${objJob.jobTitle}, ${objJob.workPeriod}. ${objJob.responsibilities}`).join(" | ")}`,
        `Skills: ${arrSelectedSkills.map((objSkill) => `${objSkill.skillCategory}: ${objSkill.skillName}. ${objSkill.skillDescription}`).join(" | ")}`
    ].join("\n")
}

const buildPrintResume = () => {
    const arrSelectedEducation = arrEducation.filter((objEducation) => objEducation.isSelected)
    const arrSelectedJobs = arrJobs.filter((objJob) => objJob.isSelected)
    const arrSelectedSkills = arrSkills.filter((objSkill) => objSkill.isSelected)
    const strName = getPlainText("#strFullName")
    const arrContact = [getPlainText("#strEmail"), getPlainText("#strPhone"), getPlainText("#strLinkedIn"), getPlainText("#strWebsite")].filter((strValue) => strValue != "")
    const strObjective = getPlainText("#strDescription")
    const divPrintResume = document.querySelector("#printResume")
    const strEducationHtml = arrSelectedEducation.map((objEducation) => {
        const strGpa = objEducation.gpa ? ` | GPA: ${escapeHtml(objEducation.gpa)}` : ""
        const strDetails = objEducation.details ? `<p>${escapeHtml(objEducation.details)}</p>` : ""

        return `<div>
            <div><strong>${escapeHtml(objEducation.school)}</strong> | ${escapeHtml(objEducation.degree)}</div>
            <div>${escapeHtml(objEducation.graduationDate)}${strGpa}</div>
            ${strDetails}
        </div>`
    }).join("")
    const strJobsHtml = arrSelectedJobs.map((objJob) => {
        const arrResponsibilityLines = splitResumeLines(objJob.responsibilities)
        const strResponsibilities = arrResponsibilityLines.length > 1 ? `<ul>${arrResponsibilityLines.map((strLine) => `<li>${escapeHtml(strLine)}</li>`).join("")}</ul>` : `<p>${escapeHtml(objJob.responsibilities)}</p>`

        return `<div>
            <div><strong>${escapeHtml(objJob.jobTitle)}</strong> | ${escapeHtml(objJob.companyName)}</div>
            <div>${escapeHtml(objJob.workPeriod)}</div>
            ${strResponsibilities}
        </div>`
    }).join("")
    const strSkillsHtml = arrSelectedSkills.map((objSkill) => {
        const strDescription = objSkill.skillDescription ? ` (${escapeHtml(objSkill.skillDescription)})` : ""
        return `<li><strong>${escapeHtml(objSkill.skillCategory)}:</strong> ${escapeHtml(objSkill.skillName)}${strDescription}</li>`
    }).join("")

    divPrintResume.innerHTML = `
        <h1>${strName}</h1>
        <p class="text-center">${escapeHtml(arrContact.join(" | "))}</p>
        ${strObjective ? `<h2>Objective</h2><p>${escapeHtml(strObjective)}</p>` : ""}
        ${strEducationHtml ? `<h2>Education</h2>${strEducationHtml}` : ""}
        ${strJobsHtml ? `<h2>Work Experience</h2>${strJobsHtml}` : ""}
        ${strSkillsHtml ? `<h2>Skills</h2><ul>${strSkillsHtml}</ul>` : ""}
    `
}

document.addEventListener("submit", (event) => {
    event.preventDefault()
})

arrDraftFieldSelectors.forEach((strSelector) => {
    document.querySelector(strSelector).addEventListener("input", () => {
        persistResumeDraft()
    })
})

document.querySelector("#loginButton").addEventListener("click", async (event) => {
    event.preventDefault()
    const {strUsername, strPassword, strErrHtml} = validateLogin()

    if (strErrHtml != "") {
        return await showAlert("Whoops!", strErrHtml, "error")
    }

    try {
        let objResult = await getJson(`${strBaseUrl}/user-login`, {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({username: strUsername, password: strPassword})
        })

        sessionStorage.setItem("username", objResult.username)
        await showHomePage()
        return await showAlert("Success!", objResult.message, "success")
    } catch (err) {
        return await showAlert("Error!", err.message, "error")
    }
})

document.querySelector("#submitButton").addEventListener("click", async (event) => {
    event.preventDefault()
    const {strUsername, strPassword, strErrHtml} = validateLogin()

    if (strErrHtml != "") {
        return await showAlert("Whoops!", strErrHtml, "error")
    }

    try {
        let objResult = await getJson(`${strBaseUrl}/user-signup`, {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({username: strUsername, password: strPassword})
        })

        sessionStorage.setItem("username", objResult.username)
        await showHomePage()
        return await showAlert("Success!", objResult.message, "success")
    } catch (err) {
        return await showAlert("Error!", err.message, "error")
    }
})

document.querySelector("#btnLogout").addEventListener("click", (event) => {
    event.preventDefault()
    clearResumeDraftStorage()
    clearResumeDraftFields()
    sessionStorage.removeItem("username")
    arrJobs = []
    arrSkills = []
    arrEducation = []
    arrResumes = []
    showLoginPage()
})

document.querySelector("#btnPrint").addEventListener("click", (event) => {
    event.preventDefault()
    buildPrintResume()
    window.print()
})

document.querySelector('#btnPrintToDoc').addEventListener("click", (event) => {
    event.preventDefault()
    exportToDocx()
})

document.querySelector("#btnSaveApiKey").addEventListener("click", async (event) => {
    event.preventDefault()
    const strApiKey = document.querySelector("#strGeminiKey").value.trim()

    if (strApiKey == "") {
        return await showAlert("Whoops!", "Gemini API Key cannot be empty.", "error")
    }

    try {
        const objResult = await getJson(`${strBaseUrl}/gemini-key`, {
            method: "PUT",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({username: getUsername(), apiKey: strApiKey})
        })

        document.querySelector("#strGeminiKey").value = ""
        blnHasGeminiKey = true
        updateGeminiStatus()
        document.querySelector("#aiSuggestions").textContent = "Gemini is connected. Use the review buttons to improve your resume wording."
        return await showAlert("Success!", objResult.message, "success")
    } catch (err) {
        return await showAlert("Error!", err.message, "error")
    }
})

document.querySelector("#btnClearApiKey").addEventListener("click", async (event) => {
    event.preventDefault()
    const objConfirm = await Swal.fire({
        title: "Clear saved Gemini key?",
        text: "This removes the saved key from this app so revoked or rate-limited keys are not reused.",
        icon: "warning",
        showCancelButton: true,
        confirmButtonText: "Clear Key"
    })

    if (!objConfirm.isConfirmed) {
        return
    }

    try {
        const objResult = await getJson(`${strBaseUrl}/gemini-key/${encodeURIComponent(getUsername())}`, {
            method: "DELETE"
        })

        blnHasGeminiKey = false
        document.querySelector("#strGeminiKey").value = ""
        document.querySelector("#aiSuggestions").textContent = "Gemini key cleared. Save a new key before requesting another review."
        updateGeminiStatus()
        return await showAlert("Success!", objResult.message, "success")
    } catch (err) {
        return await showAlert("Error!", err.message, "error")
    }
})

document.querySelector("#btnReviewObjective").addEventListener("click", async (event) => {
    event.preventDefault()
    const strObjective = getPlainText("#strDescription")

    if (strObjective == "") {
        return await showAlert("Whoops!", "Enter an objective before asking Gemini to review it.", "error")
    }

    await requestAiReview("objective", strObjective)
})

document.querySelector("#btnReviewResume").addEventListener("click", async (event) => {
    event.preventDefault()
    const strResumeContent = getSelectedResumeContent()

    if (strResumeContent.replaceAll(/\w+:\s*/g, "").trim() == "") {
        return await showAlert("Whoops!", "Add contact details or select saved resume items before asking Gemini to review the resume.", "error")
    }

    await requestAiReview("selected resume draft", strResumeContent)
})

document.querySelector("#btnSaveResume").addEventListener("click", async (event) => {
    event.preventDefault()
    persistResumeDraft()

    const objResumePayload = getResumePayload()

    if (objResumePayload.resumeName == "") {
        return await showAlert("Whoops!", "Resume name cannot be empty.", "error")
    }

    try {
        const blnUpdatingResume = strCurrentResumeId != ""
        const objResult = await getJson(`${strBaseUrl}/resumes${blnUpdatingResume ? `/${encodeURIComponent(strCurrentResumeId)}` : ""}`, {
            method: blnUpdatingResume ? "PUT" : "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify(objResumePayload)
        })
        const objSavedResume = {
            ...objResumePayload,
            resumeId: objResult.resumeId,
            userId: objResumePayload.username,
            jobIds: JSON.stringify(objResumePayload.jobIds),
            skillIds: JSON.stringify(objResumePayload.skillIds),
            educationIds: JSON.stringify(objResumePayload.educationIds),
            updatedAt: objResult.updatedAt
        }

        if (blnUpdatingResume) {
            arrResumes = arrResumes.map((objResume) => objResume.resumeId == strCurrentResumeId ? {...objResume, ...objSavedResume} : objResume)
            const optionResume = document.querySelector(`#savedResumeSelect option[value="${strCurrentResumeId}"]`)

            if (optionResume) {
                optionResume.textContent = objResumePayload.resumeName
            }
        } else {
            strCurrentResumeId = objResult.resumeId
            arrResumes.unshift(objSavedResume)
            document.querySelector("#savedResumeSelect").insertAdjacentHTML("beforeend", `<option value="${objResult.resumeId}">${escapeHtml(objResumePayload.resumeName)}</option>`)
            document.querySelector("#savedResumeSelect").value = strCurrentResumeId
        }

        persistResumeDraft()
        document.querySelector("#aiSuggestions").textContent = objResult.message
    } catch (err) {
        return await showAlert("Error!", err.message, "error")
    }
})

document.querySelector("#savedResumeSelect").addEventListener("change", (event) => {
    event.preventDefault()

    const strResumeId = event.target.value

    if (strResumeId == "") {
        strCurrentResumeId = ""
        return
    }

    const objResume = arrResumes.find((objResumeItem) => objResumeItem.resumeId == strResumeId)

    if (objResume) {
        applyResume(objResume)
        document.querySelector("#aiSuggestions").textContent = `Loaded resume: ${objResume.resumeName}`
    }
})

document.querySelector("#btnSaveEducation").addEventListener("click", async (event) => {
    event.preventDefault()
    persistResumeDraft()
    const objEducation = {
        username: getUsername(),
        school: document.querySelector("#strSchool").value.trim(),
        graduationDate: document.querySelector("#strGradDate").value.trim(),
        degree: document.querySelector("#strDegree").value.trim(),
        gpa: document.querySelector("#strGPA").value.trim(),
        details: document.querySelector("#strEducationDetails").value.trim()
    }

    try {
        const objResult = await getJson(`${strBaseUrl}/education`, {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify(objEducation)
        })

        const objSavedEducation = {
            educationId: objResult.educationId,
            userId: objEducation.username,
            school: objEducation.school,
            degree: objEducation.degree,
            graduationDate: objEducation.graduationDate,
            gpa: objEducation.gpa,
            details: objEducation.details,
            isSelected: 1,
            createdAt: new Date().toISOString()
        }

        arrEducation.push(objSavedEducation)
        appendListHtml("#educationList", getEducationHtml(objSavedEducation))
        clearEducationForm()
        restoreResumeDraft()
        document.querySelector("#aiSuggestions").textContent = "Education saved. Use the review buttons when you are ready for Gemini feedback."
    } catch (err) {
        return await showAlert("Error!", err.message, "error")
    }
})

document.querySelector("#btnSaveJob").addEventListener("click", async (event) => {
    event.preventDefault()
    persistResumeDraft()
    const objJob = {
        username: getUsername(),
        companyName: document.querySelector("#strWorkplace").value.trim(),
        jobTitle: document.querySelector("#strJobTitle").value.trim(),
        workPeriod: document.querySelector("#strWorkTime").value.trim(),
        responsibilities: document.querySelector("#strJobDesc").value.trim()
    }

    try {
        const objResult = await getJson(`${strBaseUrl}/jobs`, {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify(objJob)
        })

        const objSavedJob = {
            jobId: objResult.jobId,
            userId: objJob.username,
            companyName: objJob.companyName,
            jobTitle: objJob.jobTitle,
            workPeriod: objJob.workPeriod,
            responsibilities: objJob.responsibilities,
            isSelected: 1,
            createdAt: new Date().toISOString()
        }

        arrJobs.push(objSavedJob)
        appendListHtml("#jobsList", getJobHtml(objSavedJob))
        clearJobForm()
        restoreResumeDraft()
        document.querySelector("#aiSuggestions").textContent = "Work experience saved. Use the review buttons when you are ready for Gemini feedback."
    } catch (err) {
        return await showAlert("Error!", err.message, "error")
    }
})

document.querySelector("#btnSaveSkill").addEventListener("click", async (event) => {
    event.preventDefault()
    persistResumeDraft()
    const objSkill = {
        username: getUsername(),
        skillName: document.querySelector("#strSkill").value.trim(),
        skillCategory: document.querySelector("#strSkillCategory").value.trim(),
        skillDescription: document.querySelector("#strSkillDescription").value.trim()
    }

    try {
        const objResult = await getJson(`${strBaseUrl}/skills`, {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify(objSkill)
        })

        const objSavedSkill = {
            skillId: objResult.skillId,
            userId: objSkill.username,
            skillName: objSkill.skillName,
            skillCategory: objSkill.skillCategory || "General",
            skillDescription: objSkill.skillDescription,
            isSelected: 1,
            createdAt: new Date().toISOString()
        }

        arrSkills.push(objSavedSkill)
        appendListHtml("#skillsList", getSkillHtml(objSavedSkill))
        clearSkillForm()
        restoreResumeDraft()
        document.querySelector("#aiSuggestions").textContent = "Skill saved. Use the review buttons when you are ready for Gemini feedback."
    } catch (err) {
        return await showAlert("Error!", err.message, "error")
    }
})

document.addEventListener("change", async (event) => {
    if (!event.target.classList.contains("resume-select")) {
        return
    }

    event.preventDefault()
    const strSection = event.target.dataset.section
    const strId = event.target.dataset.id
    const blnIsSelected = event.target.checked

    try {
        await getJson(`${strBaseUrl}/${strSection}/${encodeURIComponent(strId)}`, {
            method: "PUT",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({username: getUsername(), isSelected: blnIsSelected})
        })

        if (strSection == "jobs") {
            arrJobs = arrJobs.map((objJob) => objJob.jobId == strId ? {...objJob, isSelected: blnIsSelected ? 1 : 0} : objJob)
        } else if (strSection == "skills") {
            arrSkills = arrSkills.map((objSkill) => objSkill.skillId == strId ? {...objSkill, isSelected: blnIsSelected ? 1 : 0} : objSkill)
        } else if (strSection == "education") {
            arrEducation = arrEducation.map((objEducation) => objEducation.educationId == strId ? {...objEducation, isSelected: blnIsSelected ? 1 : 0} : objEducation)
        }
    } catch (err) {
        await showAlert("Error!", err.message, "error")
        event.target.checked = !blnIsSelected
    }
})

document.addEventListener("click", async (event) => {
    if (!event.target.classList.contains("delete-entry")) {
        return
    }

    event.preventDefault()
    const strSection = event.target.dataset.section
    const strId = event.target.dataset.id
    const objConfirm = await Swal.fire({
        title: "Remove entry?",
        text: "This will permanently remove this saved resume item.",
        icon: "warning",
        showCancelButton: true,
        confirmButtonText: "Remove"
    })

    if (!objConfirm.isConfirmed) {
        return
    }

    try {
        await getJson(`${strBaseUrl}/${strSection}/${encodeURIComponent(strId)}?username=${encodeURIComponent(getUsername())}`, {
            method: "DELETE"
        })

        if (strSection == "jobs") {
            arrJobs = arrJobs.filter((objJob) => objJob.jobId != strId)
            removeListHtml("#jobsList", strId, "No work experience has been saved yet.")
        } else if (strSection == "skills") {
            arrSkills = arrSkills.filter((objSkill) => objSkill.skillId != strId)
            removeListHtml("#skillsList", strId, "No skills have been saved yet.")
        } else if (strSection == "education") {
            arrEducation = arrEducation.filter((objEducation) => objEducation.educationId != strId)
            removeListHtml("#educationList", strId, "No education has been saved yet.")
        }
    } catch (err) {
        return await showAlert("Error!", err.message, "error")
    }
})

if (getUsername() != "") {
    await showHomePage()
} else {
    showLoginPage()
    updateGeminiStatus()
}
