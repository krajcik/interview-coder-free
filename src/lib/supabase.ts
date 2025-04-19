// Mock Supabase client for the application to run without authentication

// Create a mock client that doesn't do anything
export const supabase = {
  auth: {
    getUser: async () => ({ data: { user: null }, error: null }),
    signInWithOAuth: async () => ({ data: null, error: null }),
    signInWithPassword: async () => ({ data: null, error: null }),
    signUp: async () => ({ data: null, error: null }),
    signOut: async () => ({ error: null }),
    onAuthStateChange: () => {
      return { data: { subscription: { unsubscribe: () => {} } } }
    },
    exchangeCodeForSession: async () => ({ data: null, error: null })
  },
  from: () => ({
    select: () => ({
      eq: () => ({
        single: async () => ({ data: null, error: null }),
        maybeSingle: async () => ({ data: null, error: null })
      }),
      maybeSingle: async () => ({ data: null, error: null })
    }),
    update: () => ({
      eq: () => ({
        select: () => ({
          single: async () => ({ data: null, error: null })
        })
      })
    })
  }),
  channel: () => ({
    on: () => ({
      subscribe: () => ({
        unsubscribe: () => {}
      })
    }),
    subscribe: () => ({
      unsubscribe: () => {}
    }),
    unsubscribe: () => {}
  })
}

// Mock sign in function
export const signInWithGoogle = async () => {
  console.log("Mock Google sign in...")
  return { url: "#" }
}

let channel: ReturnType<typeof supabase.channel> | null = null

// Monitor auth state changes and manage realtime connection
supabase.auth.onAuthStateChange((event, session) => {
  console.log("Auth state changed:", event, session?.user?.id)
  console.log("Full session data:", session)

  if (event === "SIGNED_IN" && session) {
    // Only establish realtime connection after successful sign in
    console.log("Establishing realtime connection...")

    // Clean up existing channel if any
    if (channel) {
      channel.unsubscribe()
    }

    channel = supabase.channel("system", {
      config: {
        presence: {
          key: session.user.id
        }
      }
    })

    channel
      .on("system", { event: "*" }, (payload) => {
        console.log("System event:", payload)
      })
      .subscribe((status) => {
        console.log("Realtime subscription status:", status)
        if (status === "SUBSCRIBED") {
          console.log("Successfully connected to realtime system")
        }
        if (status === "CHANNEL_ERROR") {
          console.error("Realtime connection error - will retry in 5s")
          setTimeout(() => {
            channel?.subscribe()
          }, 5000)
        }
      })
  }

  if (event === "SIGNED_OUT") {
    // Clean up realtime connection on sign out
    if (channel) {
      console.log("Cleaning up realtime connection")
      channel.unsubscribe()
      channel = null
    }
  }
})
