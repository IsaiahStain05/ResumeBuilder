import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs/promises'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

let mainWindow

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.loadFile('index.html')
}

// Create DOCX document function
async function createDocxFromResume(resumeData) {
  // We'll use dynamic import since docx might not be ESM
  const { Document, Packer, Paragraph, TextRun, HeadingLevel } = await import('docx')
  
  const children = []

  // Name
  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: resumeData.name,
          bold: true,
          size: 32
        })
      ]
    })
  )

  // Contact info
  if (resumeData.contact && resumeData.contact.length) {
    children.push(
      new Paragraph({
        text: resumeData.contact.join(' | ')
      })
    )
  }

  // Objective
  if (resumeData.objective) {
    children.push(
      new Paragraph({
        text: 'Objective',
        heading: HeadingLevel.HEADING_1
      }),
      new Paragraph(resumeData.objective)
    )
  }

  // Education
  if (resumeData.education && resumeData.education.length) {
    children.push(
      new Paragraph({
        text: 'Education',
        heading: HeadingLevel.HEADING_1
      })
    )

    resumeData.education.forEach(edu => {
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

  // Work Experience
  if (resumeData.jobs && resumeData.jobs.length) {
    children.push(
      new Paragraph({
        text: 'Work Experience',
        heading: HeadingLevel.HEADING_1
      })
    )

    resumeData.jobs.forEach(job => {
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

      if (job.responsibilities && Array.isArray(job.responsibilities)) {
        job.responsibilities.forEach(line => {
          if (line && line.trim()) {
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
      }
    })
  }

  // Skills
  if (resumeData.skills && resumeData.skills.length) {
    children.push(
      new Paragraph({
        text: 'Skills',
        heading: HeadingLevel.HEADING_1
      })
    )

    resumeData.skills.forEach(skill => {
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

  return { Document, Packer, doc }
}

// IPC Handler for DOCX export
ipcMain.handle('export-docx', async (event, resumeData) => {
  try {
    console.log('Exporting DOCX with data:', resumeData)

    // Show save dialog
    const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
      title: 'Save Resume',
      defaultPath: `${resumeData.name || 'resume'}.docx`,
      filters: [
        { name: 'Word Documents', extensions: ['docx'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })

    if (canceled || !filePath) {
      return { success: false, message: 'Export canceled' }
    }

    // Generate DOCX
    const { Packer, doc } = await createDocxFromResume(resumeData)
    const buffer = await Packer.toBuffer(doc)

    // Save file
    await fs.writeFile(filePath, buffer)
    
    return { 
      success: true, 
      message: 'Resume saved successfully!',
      filePath: filePath 
    }
    
  } catch (error) {
    console.error('DOCX export error:', error)
    return { 
      success: false, 
      message: `Export failed: ${error.message}` 
    }
  }
})

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})