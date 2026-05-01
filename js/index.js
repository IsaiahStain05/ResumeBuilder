const BASE_URL = "http://localhost:3000"

document.querySelector('#loginButton').addEventListener('click', async () => {
    const username = document.querySelector('#txtUser').value
    const password = document.querySelector('#txtPassword').value
    let errHtml = ""

    if (username == ""){
        errHtml += "<div>Username cannot be empty.</div>"
    }

    if (password == ""){
        errHtml += "<div>Password cannot be empty.</div>"
    }

    if (errHtml != '') {
        return Swal.fire({
            title: "Whoops!",
            icon: "error",
            html: errHtml
        })
    }

    let rawResult = await fetch(`${BASE_URL}/user-login`, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({username: username, password: password})})
    let result = await rawResult.json()

    if (result.outcome == "success") {
        sessionStorage.setItem("username", result.username)
        document.querySelector('#loginPage').style.display = "none"
        return Swal.fire({
            title: "Success!",
            html: result.message,
            icon: "success"
        })
    } else {
        return Swal.fire({
            title: "Error!",
            html: result.message,
            icon: "error"
        })
    }
})

document.querySelector('#submitButton').addEventListener('click', async () => {
    const username = document.querySelector('#txtUser').value
    const password = document.querySelector('#txtPassword').value
    let errHtml = ""

    if (username == ""){
        errHtml += "<div>Username cannot be empty.</div>"
    }

    if (password == ""){
        errHtml += "<div>Password cannot be empty.</div>"
    }

    if (errHtml != '') {
        return Swal.fire({
            title: "Whoops!",
            icon: "error",
            html: errHtml
        })
    }

    let rawResult = await fetch(`${BASE_URL}/user-signup`, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({username: username, password: password})})
    let result = await rawResult.json()

    if (result.outcome == "success") {
        sessionStorage.setItem("username", result.username)
        document.querySelector('#loginPage').style.display = "none"
        return Swal.fire({
            title: "Success!",
            html: result.message,
            icon: "success"
        })
    } else {
        return Swal.fire({
            title: "Error!",
            html: result.message,
            icon: "error"
        })
    }
})