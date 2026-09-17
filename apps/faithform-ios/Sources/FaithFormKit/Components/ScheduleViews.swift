import SwiftUI

/// The Home Schedule calendar: month grid and poster cards for the selected day.
public struct ScheduleView: View {
    @Environment(\.faithformTheme) private var theme
    private let model: ScheduleModel
    private let churchName: String
    private let churchSlug: String
    private let churchTimezone: String
    private let isJoinPending: Bool
    private let onOpenItem: @MainActor (FeedItem) -> Void

    @State private var selectedDay = Date()

    public init(
        model: ScheduleModel,
        churchName: String,
        churchSlug: String,
        churchTimezone: String,
        isJoinPending: Bool = false,
        onOpenItem: @escaping @MainActor (FeedItem) -> Void
    ) {
        self.model = model
        self.churchName = churchName
        self.churchSlug = churchSlug
        self.churchTimezone = churchTimezone
        self.isJoinPending = isJoinPending
        self.onOpenItem = onOpenItem
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.lg) {
                if isJoinPending {
                    JoinPendingBanner()
                }
                content
            }
            .padding(.horizontal, FaithFormTokens.Layout.screenPaddingHorizontal)
            .padding(.vertical, FaithFormTokens.Spacing.base)
            .frame(maxWidth: FaithFormTokens.Layout.contentMaxWidth)
        }
        .background(theme.palette.background)
        .refreshable { await model.refresh(churchSlug: churchSlug) }
        .onChange(of: model.displayedMonth) { _, _ in
            selectedDay = todayInChurchZone()
        }
        .onAppear {
            selectedDay = todayInChurchZone()
        }
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            FeedSkeleton()

        case let .loaded(items, isStale):
            if isStale {
                OfflineBanner(message: L.offlineCached)
            }
            calendar(items: items)
            dayEvents(items: items)

        case .empty:
            calendar(items: [])
            EmptyStateView(
                title: L.emptyScheduleTitle,
                explanation: L.emptyScheduleBody,
                symbol: "calendar"
            )

        case .offlineNoCache:
            EmptyStateView(title: L.offlineTitle, explanation: L.offlineBody, symbol: "wifi.slash")

        case .blocked:
            EmptyStateView(title: L.blockedTitle, explanation: L.blockedBody, symbol: "hand.raised")

        case let .failed(message):
            VStack(spacing: FaithFormTokens.Spacing.base) {
                EmptyStateView(title: L.errorTitle, explanation: message, symbol: "exclamationmark.triangle")
                Button(L.retry) {
                    Task { await model.refresh(churchSlug: churchSlug) }
                }
                .buttonStyle(FaithFormButtonStyle(kind: .secondary, theme: theme))
            }
        }
    }

    private func calendar(items: [FeedItem]) -> some View {
        VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.base) {
            HStack {
                Button {
                    Task { await model.showPreviousMonth() }
                } label: {
                    Image(systemName: "chevron.left")
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text(L.schedulePreviousMonth))

                Spacer()

                Text(ScheduleCalendar.monthTitle(model.displayedMonth, timezone: churchTimezone))
                    .font(theme.font(FaithFormTokens.Text.titleLarge))
                    .foregroundStyle(theme.palette.contentPrimary)

                Spacer()

                Button {
                    Task { await model.showNextMonth() }
                } label: {
                    Image(systemName: "chevron.right")
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text(L.scheduleNextMonth))
            }

            let headers = ScheduleCalendar.weekdayHeaders(timezone: churchTimezone)
            LazyVGrid(
                columns: Array(repeating: GridItem(.flexible(), spacing: FaithFormTokens.Spacing.xs), count: 7),
                spacing: FaithFormTokens.Spacing.xs
            ) {
                ForEach(headers, id: \.self) { header in
                    Text(header)
                        .font(theme.font(FaithFormTokens.Text.caption))
                        .foregroundStyle(theme.mutedContent)
                        .frame(maxWidth: .infinity)
                }

                ForEach(0..<ScheduleCalendar.leadingBlankDays(model.displayedMonth, timezone: churchTimezone), id: \.self) { _ in
                    Color.clear.frame(height: 44)
                }

                ForEach(ScheduleCalendar.daysInMonth(model.displayedMonth, timezone: churchTimezone), id: \.self) { day in
                    dayCell(day: day, items: items)
                }
            }
        }
        .padding(FaithFormTokens.Spacing.base)
        .background(
            RoundedRectangle(cornerRadius: FaithFormTokens.Radius.lg, style: .continuous)
                .fill(theme.palette.surface)
        )
        .overlay(
            RoundedRectangle(cornerRadius: FaithFormTokens.Radius.lg, style: .continuous)
                .strokeBorder(theme.palette.border, lineWidth: FaithFormTokens.BorderWidth.hairline)
        )
    }

    private func dayCell(day: Date, items: [FeedItem]) -> some View {
        let hasEvents = ScheduleCalendar.eventOverlapsAny(in: items, day: day)
        let isSelected = ScheduleCalendar.isSameDay(day, selectedDay, timezone: churchTimezone)
        let isToday = ScheduleCalendar.isSameDay(day, todayInChurchZone(), timezone: churchTimezone)

        return Button {
            selectedDay = day
        } label: {
            VStack(spacing: FaithFormTokens.Spacing.xs) {
                Text(ScheduleCalendar.dayNumber(day, timezone: churchTimezone))
                    .font(theme.font(FaithFormTokens.Text.label))
                    .foregroundStyle(isSelected ? theme.palette.contentOnAccent : theme.palette.contentPrimary)
                    .frame(width: 36, height: 36)
                    .background(
                        Circle()
                            .fill(isSelected ? theme.palette.brandAccent : Color.clear)
                    )
                    .overlay {
                        if isToday && !isSelected {
                            Circle()
                                .strokeBorder(theme.palette.brandAccent, lineWidth: FaithFormTokens.BorderWidth.standard)
                        }
                    }

                Circle()
                    .fill(hasEvents ? theme.palette.brandAccent : Color.clear)
                    .frame(width: 6, height: 6)
            }
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(dayAccessibilityLabel(day: day, hasEvents: hasEvents, isSelected: isSelected)))
    }

    private func dayEvents(items: [FeedItem]) -> some View {
        let dayItems = ScheduleCalendar.events(on: selectedDay, in: items)
        return VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.md) {
            Text(L.upcomingEvents)
                .font(theme.font(FaithFormTokens.Text.titleMedium))
                .foregroundStyle(theme.palette.contentPrimary)

            if dayItems.isEmpty {
                Text(L.emptyScheduleDayBody)
                    .font(theme.font(FaithFormTokens.Text.bodySmall))
                    .foregroundStyle(theme.mutedContent)
            } else {
                ForEach(dayItems, id: \.id) { item in
                    AnnouncementCard(item: item) { onOpenItem(item) }
                }
            }
        }
    }

    private func todayInChurchZone() -> Date {
        let zone = TimeZone(identifier: churchTimezone) ?? .current
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone
        return calendar.startOfDay(for: Date())
    }

    private func dayAccessibilityLabel(day: Date, hasEvents: Bool, isSelected: Bool) -> String {
        let formatter = DateFormatter()
        formatter.timeZone = TimeZone(identifier: churchTimezone) ?? .current
        formatter.dateStyle = .full
        var parts = [formatter.string(from: day)]
        if isSelected { parts.append(L.scheduleSelectedDay) }
        if hasEvents { parts.append(L.scheduleHasEvents) }
        return parts.joined(separator: ", ")
    }
}

private extension ScheduleCalendar {
    static func eventOverlapsAny(in items: [FeedItem], day: Date) -> Bool {
        items.contains { event($0, overlaps: day) }
    }
}
