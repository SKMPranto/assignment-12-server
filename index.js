require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const { use } = require("react");
const { default: Stripe } = require("stripe");
const app = express();
const port = process.env.PORT || 5000;
const stripe = require("stripe")(process.env.STRIPE_PAYMENT_SECRET_KEY);

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
    const paymentHistoryCollection = client
      .db("tapandearnDB")
      .collection("paymentHistory");

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

    // Get a specific task by ID
    app.get("/tasks/task/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const task = await tasksCollection.findOne(query);
        res.send(task);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Failed to fetch task" });
      }
    });

    // Update task
    app.put("/tasks/:id", async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const options = { upsert: true };
      const updateTask = req.body;
      const updateDoc = {
        $set: updateTask,
      };
      const result = await tasksCollection.updateOne(
        filter,
        updateDoc,
        options
      );
      res.send(result);
    });

    // Delete a task by ID and adjust user's coin
    app.delete("/tasks/:id", async (req, res) => {
      try {
        const id = req.params.id;

        //  Find the task first
        const task = await tasksCollection.findOne({ _id: new ObjectId(id) });
        if (!task) return res.status(404).send({ message: "Task not found" });

        //  Calculate refill amount
        const refillAmount = task.required_workers * task.payable_amount;

        //  Update user's coins (assuming you have a usersCollection and task.email)
        await usersCollection.updateOne(
          { email: task.email },
          { $inc: { coins: refillAmount } }
        );

        //  Delete the task
        const result = await tasksCollection.deleteOne({
          _id: new ObjectId(id),
        });

        res.send(result);
      } catch (error) {
        console.error(error);
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

    //  PATCH user coins after purchase
    app.patch("/users/:email/add-coins", async (req, res) => {
      const email = req.params.email;
      const { coins } = req.body;
      try {
        const result = await usersCollection.updateOne(
          { email },
          { $inc: { coins: coins } } // increment coins
        );
        res.send(result);
      } catch (err) {
        res.status(500).send({ message: "Server error" });
      }
    });

    // ---------------------------------- Stripe Payment Intent --------------------------------------

    app.post("/create-payment-intent", async (req, res) => {
      const amountInCents = req.body.amountInCents;
      try {
        const paymentIntent = await stripe.paymentIntents.create({
          amount: amountInCents, // in cents
          currency: "usd",
          payment_method_types: ["card"],
        });
        res.json({ clientSecret: paymentIntent.client_secret });
      } catch (error) {
        console.error("Stripe Error:", error.message);
        res.status(500).json({ error: error.message });
      }
    });

    // ----------------- Save Payment history --------------+
    // Save payment history
    app.post("/payment-history", async (req, res) => {
      try {
        const { name, email, coins, amount, transactionId, date, card } =
          req.body;

        //  Check all required fields
        if (
          !name ||
          !email ||
          !coins ||
          !amount ||
          !transactionId ||
          !date ||
          !card
        ) {
          return res.status(400).json({ error: "Missing required fields" });
        }

        const payment = {
          name,
          email,
          coins,
          amount,
          transactionId,
          date,
          card,
        };

        const result = await paymentHistoryCollection.insertOne(payment);

        res.status(201).json({
          success: true,
          message: "Payment history saved",
          insertedId: result.insertedId,
        });
      } catch (error) {
        console.error("Error saving payment history:", error);
        res.status(500).json({ error: "Failed to save payment history" });
      }
    });

    // Get all the data for a user

    app.get("/payments/:email", async (req, res) => {
      try {
        const email = req.params.email;
        const result = await paymentHistoryCollection.find({ email }).toArray();
        res.status(200).json(result);
      } catch (error) {
        console.error("Error fetching payment history:", error);
        res.status(500).json({ error: "Failed to fetch payment history" });
      }
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
