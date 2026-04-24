import { v4 as uuid } from "uuid"
import express from "express"
import bcrypt, { compareSync } from "bcrypt"
import cors from "cors"
import sqlite3 from "sqlite3"
const PORT = 3000

var app = express()

app.use(express.json())
app.use(cors())

const hashPassword = async (password) => {
    return await bcrypt.hash(password, 10)
}

const dbResume = new sqlite3.Database('./db/Resume.db', (err) => {
    if (err) {
        console.error("Error opening database:", err)
    } else {
        console.log("Database connection successful!")
    }
})

app.listen(PORT, () => {
    console.log("App listening on", PORT)
})

process.on("uncaughtException", (err) => {
  console.error(err);
});

process.on("unhandledRejection", (err) => {
  console.error(err);
});

app.post('/user-login', async (req, res, next) => {
    try {
        let username = req.body.username
        let password = req.body.password

        let hashedPassword = await hashPassword(password)

        let getQuery = "SELECT username, password FROM tblUser WHERE username = ?"
        dbResume.all(getQuery, [username], (err, rows) => {
            if (err) {
                return res.status(500).json({outcome: "failure", message: `<p>${err}</p>`})
            } else {
                if (rows.length == 1 && compareSync(password, rows[0].password)) {
                    return res.status(200).json({outcome: "success", message: "<p>Logged in!</p>", username: username})
                } else if (rows.length == 1 && !compareSync(password, rows[0].password)) {
                    return res.status(401).json({outcome:"failure", message:"<p>Incorrect password!</p>"})
                }else if (rows.length == 0) {
                    res.status(404).json({outcome: "failure", message: "<p>No user by that name exists.</p>"})
                } else if (rows.length > 1) {
                    return res.status(500).json({outcome: "failure", message: "<p>You have done the unspeakable.</p>"})
                } 
            }
        })
    } catch (err) {
        return res.status(400).json({outcome: "failure", message: `<p>${err}</p>`})
    }
})

app.post('/user-signup', async (req, res, next) => {
    try {
        let username = req.body.username
        let password = req.body.password

        let hashedPassword = await hashPassword(password)

        let getQuery = "SELECT username, password FROM tblUser WHERE username = ?"
        dbResume.all(getQuery, [username], (err, rows) => {
            if (err) {
                return res.status(500).json({outcome: "failure", message: `<p>${err}</p>`})
            } else {
                if (rows.length == 1 && !compareSync(password, rows[0].password)) {
                    return res.status(401).json({outcome: "failure", message: "<p>An account already exists with that name (possibly wrong password)!</p>"})
                } else if (rows.length == 1 && compareSync(password, rows[0].password)) {
                    return res.status(200).json({outcome:"success", message:"<p>Signed in!</p>", username: username})
                } else if (rows.length > 1) {
                    return res.status(500).json({outcome: "failure", message: "<p>You have done the unspeakable.</p>"})
                } else if (rows.length == 0) {
                    let postQuery = "INSERT INTO tblUser VALUES (?, ?)"
                    dbResume.run(postQuery, [username, hashedPassword], (err) => {
                        if(err){
                            return res.status(500).json({outcome: "failure", message: `<p>${err}</p>`})
                        } else {
                            return res.status(200).json({outcome: "success", message: `<p>User created with username: ${username}`, username: username})
                        }
                    })
                }
            }
        })

    } catch (err) {
        return res.status(400).json({outcome: "failure", message: `<p>${err}</p>`})
    }
})