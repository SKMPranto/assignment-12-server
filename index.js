require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const { use } = require("react");
const app = express();
const port = process.env.PORT || 5000;

// MiddleWares

app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster01.gad8k91.mongodb.net/?retryWrites=true&w=majority&appName=Cluster01`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
    const tasksCollection = client.db("tapandearnDB").collection("tasks");
    const usersCollection = client.db("tapandearnDB").collection("users");

    // -------------------------------- Tasks API -----------------------------------------------
    // Post tasks method
    app.post("/tasks", async (req, res) => {
      const newTask = req.body;
      const result = await tasksCollection.insertOne(newTask);
      res.send(result);
    });

    // Get all tasks added by a specific user
    app.get("/tasks/:email", async (req, res) => {
      const email = req.params.email;
      const result = await tasksCollection.find({ email }).toArray();
      res.send(result);
    });

    // ✅ Delete a task by ID
    app.delete("/tasks/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await tasksCollection.deleteOne(query);
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Server error" });
      }
    });

    // get tasks method
    app.get("/tasks", async (req, res) => {
      const result = await tasksCollection.find().toArray();
      res.send(result);
    });

    // ------------------------------  Users API   -----------------------------------------------

    // Save the users in db
    app.post("/users", async (req, res) => {
      const { username, email, role, photoURL } = req.body;

      const exists = await usersCollection.findOne({ email });
      if (exists) {
        return res
          .status(200)
          .send({ message: "User already exists", inserted: false });
      }

      let coins = 0;
      if (role === "Worker") coins = 10;
      else if (role === "Buyer") coins = 50;

      const newUser = {
        username,
        email,
        role,
        photoURL: photoURL || null,
        coins,
        createdAt: new Date(),
        lastLogin: new Date(),
      };

      const result = await usersCollection.insertOne(newUser);
      res
        .status(201)
        .send({ message: "User created successfully", user: newUser });
    });

    // ----------- Get a single user by email
    app.get("/users/:email", async (req, res) => {
      try {
        const email = req.params.email;
        const user = await usersCollection.findOne({ email });

        if (!user) {
          return res.status(404).send({ message: "User not found" });
        }

        res.send(user);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    // -------- deduct Coin amount ---------
    app.patch("/users/:email/deduct-coins", async (req, res) => {
      const email = req.params.email;
      const { amount } = req.body;

      const result = await usersCollection.updateOne(
        { email },
        { $inc: { coins: -amount } }
      );

      res.send(result);
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

// Default route
app.get("/", (req, res) => {
  res.send("Tap and Earn Server is running 🚀");
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
