import ClerkKitUI
import SwiftUI

struct SignInView: View {
    @State private var authIsPresented = false

    var body: some View {
        ZStack {
            Stillness.page.ignoresSafeArea()

            VStack(spacing: 22) {
                Text("drft")
                    .font(.custom("Helvetica Neue", size: 22).weight(.light))
                    .tracking(11)
                    .foregroundStyle(Stillness.faint)

                Text("a space for unfinished thoughts")
                    .font(.custom("Helvetica Neue", size: 15).weight(.light))
                    .foregroundStyle(Stillness.muted)

                Button {
                    authIsPresented = true
                } label: {
                    Text("sign in")
                        .font(StillnessType.action)
                        .tracking(1)
                        .foregroundStyle(Stillness.ink)
                        .padding(.bottom, 6)
                        .overlay(alignment: .bottom) {
                        Hairline()
                    }
                    .fixedSize()
                }
                .buttonStyle(.plain)
            }
            .padding(32)
        }
        .sheet(isPresented: $authIsPresented) {
            AuthView(mode: .signIn)
                .tint(Stillness.ink)
        }
    }
}
